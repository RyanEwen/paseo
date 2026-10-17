import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";

export function seedPluginLinks(paseoHome, workspaceId, url, remoteWorkspaceId) {
  const directory = path.join(paseoHome, "link-plugin");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: "link-check", requirements: { paseo: ">=0.8.0" } }),
  );
  fs.writeFileSync(
    path.join(directory, "index.client.tsx"),
    `
import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
function Links({ navigation }) {
  const [result, setResult] = useState("Ready");
  return <View>
    <Text>{result}</Text>
    <Pressable accessibilityRole="button" onPress={() => { window.open(${JSON.stringify(url)}, "_blank", "noopener,noreferrer"); }}><Text>Old documentation workaround</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={async () => { try { await openExternalUrl(${JSON.stringify(url)}); setResult("Opened externally"); } catch (error) { setResult(String(error)); } }}><Text>Open externally</Text></Pressable>
    {ExternalLink ? <ExternalLink href={${JSON.stringify(url)}}>Documentation link</ExternalLink> : null}
    <Pressable accessibilityRole="button" onPress={() => navigation.openBrowser({ url: ${JSON.stringify(url)}, workspaceId: ${JSON.stringify(remoteWorkspaceId)}, serverId: "plugin-links-remote" })}><Text>Open remote workspace browser</Text></Pressable>
    <Text>{navigation.openBrowser ? "Browser available" : "Browser unavailable"}</Text>
    <Pressable accessibilityRole="button" onPress={() => navigation.openBrowser({ url: ${JSON.stringify(url)}, workspaceId: ${JSON.stringify(workspaceId)} })}><Text>Open workspace browser</Text></Pressable>
  </View>;
}
function WorkspaceLinks() { return <ExternalLink href={${JSON.stringify(url)}}>Workspace documentation link</ExternalLink>; }
export default function(client) {
  client.addSurface("main", Links);
  client.addSidebarItem({ id: "links", title: "Plugin links QA", icon: "Link", surface: "main" });
  client.addWorkspacePanel({ id: "workspace-links", title: "Workspace links QA", icon: "Link", context: "workspace", locations: ["workspace"], Component: WorkspaceLinks });
  client.addCommandCenterItem({ id: "workspace-links", title: "Open workspace links QA", icon: "Link", context: "workspace", onSelect({ openPanel }) { openPanel("workspace-links"); } });
  return () => {};
}
`,
  );
  const configPath = path.join(paseoHome, "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.pluginsEnabled = true;
  config.plugins = { "link-check": { source: "directory", path: directory, enabled: true } };
  fs.writeFileSync(configPath, JSON.stringify(config));
}

export async function runPluginLinksRegression({
  page,
  remotePort,
  serverId,
  createChatAgent,
  workspaceId,
  remoteWorkspaceId,
  url,
  artifactDir,
  externalOpenLog,
}) {
  const pluginEntry = page.getByRole("button", { name: "Plugin links QA", exact: true });
  await expect(pluginEntry).toBeVisible({ timeout: 90_000 });
  await page.evaluate((port) => {
    const key = "@paseo:daemon-registry";
    const registry = JSON.parse(localStorage.getItem(key));
    const endpoint = `127.0.0.1:${port}`;
    const connection = { id: `direct:${endpoint}`, type: "directTcp", endpoint };
    const now = new Date().toISOString();
    registry.push({
      serverId: "plugin-links-remote",
      label: "Remote browser host",
      connections: [connection],
      preferredConnectionId: connection.id,
      createdAt: now,
      updatedAt: now,
    });
    localStorage.setItem(key, JSON.stringify(registry));
  }, remotePort);
  await page.reload();
  await pluginEntry.click();
  await expect(
    page.getByRole("button", { name: "Old documentation workaround", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  const oldPopup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Old documentation workaround", exact: true }).click();
  const popup = await oldPopup;
  await popup.waitForLoadState();
  await popup.screenshot({ path: path.join(artifactDir, "plugin-old-popup.png") });
  await popup.close();

  const popups = [];
  page.on("popup", (openedPopup) => popups.push(openedPopup));
  await page.getByRole("button", { name: "Open externally", exact: true }).click();
  await expect(page.getByText("Opened externally", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Documentation link", exact: true }).click();
  if (externalOpenLog) {
    await expect
      .poll(() => fs.readFileSync(externalOpenLog, "utf8").trim().split("\n"))
      .toEqual([url, url]);
  }
  await expect(page.getByText("Browser available", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open workspace browser", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${workspaceId}`));
  await expectPresentedBrowser(page, url);
  expect(popups).toHaveLength(0);
  await page.screenshot({ path: path.join(artifactDir, "plugin-workspace-browser.png") });
  const workspaceOptions = await verifyWorkspaceLinkOptions({
    page,
    url,
    artifactDir,
    externalOpenLog,
  });
  const chatLinks = await verifyChatLinkDestinations({
    page,
    serverId,
    workspaceId,
    url,
    artifactDir,
    externalOpenLog,
    createChatAgent,
  });
  const repositoryLinks = await verifyRepositoryLinkOptions({ page, artifactDir, externalOpenLog });
  await pluginEntry.click();
  await page.getByRole("button", { name: "Open remote workspace browser", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/h/plugin-links-remote/workspace/${remoteWorkspaceId}`));
  await expectPresentedBrowser(page, url);
  await page.screenshot({ path: path.join(artifactDir, "plugin-remote-workspace-browser.png") });
  return {
    remoteWorkspaceId,
    oldWorkaroundOpenedPopup: true,
    workspaceOptions,
    chatLinks,
    repositoryLinks,
    newExternalPopups: popups.length,
    workspaceId,
    url,
  };
}

async function expectPresentedBrowser(page, url) {
  await expect
    .poll(() =>
      page
        .locator("webview")
        .evaluateAll((views) =>
          views
            .filter((view) => view.parentElement?.getAttribute("aria-hidden") === "false")
            .map((view) => view.getURL()),
        ),
    )
    .toEqual([url]);
}

/** Exercise contextual SDK links through the real retained workspace-panel host. */
async function verifyWorkspaceLinkOptions({ page, url, artifactDir, externalOpenLog }) {
  await page.getByTestId("sidebar-search").click();
  const palette = page.getByTestId("command-center-panel");
  await palette.getByTestId("command-center-input").fill("Open workspace links QA");
  await palette.getByRole("button", { name: "Open workspace links QA", exact: true }).click();
  const link = page.getByRole("link", { name: "Workspace documentation link", exact: true });
  await expect(link).toBeVisible();
  await link.click();
  if (externalOpenLog) {
    await expect
      .poll(() => fs.readFileSync(externalOpenLog, "utf8").trim().split("\n"))
      .toEqual([url, url, url]);
  }
  await link.click({ button: "right" });
  await page.getByText("Open in Paseo browser", { exact: true }).click();
  await expectPresentedBrowser(page, url);
  await page.screenshot({ path: path.join(artifactDir, "workspace-link-internal-option.png") });
  return { defaultExternal: true, internalOption: true };
}

/** Verify settled chat links use their real renderer, provider, workspace tabs and OS opener. */
async function verifyChatLinkDestinations({
  page,
  serverId,
  workspaceId,
  url,
  artifactDir,
  externalOpenLog,
  createChatAgent,
}) {
  const agentId = await createChatAgent();
  const route = new URL(
    `/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(workspaceId)}?open=${encodeURIComponent(`agent:${agentId}`)}`,
    page.url(),
  ).href;
  await page.goto(route);
  const deck = page.getByTestId(`workspace-deck-entry-${serverId}:${workspaceId}`);
  const agentTab = deck.getByTestId(`workspace-tab-agent_${agentId}`);
  const link = page
    .getByTestId("assistant-message")
    .getByRole("link", { name: "Workspace chat link", exact: true })
    .last();
  await expect(link).toBeVisible({ timeout: 30_000 });
  const priorExternal = externalOpenLog ? fs.readFileSync(externalOpenLog, "utf8") : null;
  await link.click();
  await expectPresentedBrowser(page, url);
  if (externalOpenLog) {
    expect(fs.readFileSync(externalOpenLog, "utf8")).toBe(priorExternal);
  }
  await agentTab.click();
  await link.click({ button: "right" });
  await expect(page.getByText("Open in external browser", { exact: true })).toBeVisible();
  await expect(page.getByTestId("workspace-http-link-menu")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: path.join(artifactDir, "workspace-chat-external-menu.png") });
  await page.getByText("Open in external browser", { exact: true }).click();
  if (externalOpenLog) {
    await expect
      .poll(() => fs.readFileSync(externalOpenLog, "utf8").trim().split("\n"))
      .toEqual([url, url, url, url]);
  }
  await expect(agentTab).toHaveAttribute("aria-selected", "true");
  return { agentId, primaryInternal: true, externalContextMenu: true };
}

/** Exercise the actual titlebar repository target, retaining its selected external default. */
async function verifyRepositoryLinkOptions({ page, artifactDir, externalOpenLog }) {
  const url = "https://github.com/acme/workspace-links/tree/main";
  const caret = page.getByTestId("workspace-open-in-editor-caret");
  const primary = page.getByTestId("workspace-open-in-editor-primary");
  await caret.click();
  await page.getByTestId("workspace-open-in-editor-item-github").click();
  await expect(primary).toHaveAttribute("aria-label", "Open workspace in GitHub");
  await primary.click();
  if (externalOpenLog) {
    await expect
      .poll(() => fs.readFileSync(externalOpenLog, "utf8").trim().split("\n").at(-1))
      .toBe(url);
  }
  const priorExternal = externalOpenLog ? fs.readFileSync(externalOpenLog, "utf8") : null;
  await caret.click();
  await expect(page.getByTestId("workspace-open-in-editor-menu")).toHaveCSS("opacity", "1");
  const internalOption = page.getByText("Open in Paseo browser", { exact: true });
  await expect
    .poll(() =>
      internalOption.evaluate((element) => {
        const hasWidth = element.clientWidth > 0;
        const fits = element.scrollWidth <= element.clientWidth;
        return hasWidth && fits;
      }),
    )
    .toBe(true);
  await page.screenshot({
    path: path.join(artifactDir, "workspace-repository-internal-option.png"),
  });
  await page.getByText("Open in Paseo browser", { exact: true }).click();
  await expectPresentedBrowser(page, url);
  await expect(primary).toHaveAttribute("aria-label", "Open workspace in GitHub");
  if (externalOpenLog) {
    expect(fs.readFileSync(externalOpenLog, "utf8")).toBe(priorExternal);
  }
  return { url, defaultExternal: true, internalOption: true, preferredTargetRetained: true };
}
