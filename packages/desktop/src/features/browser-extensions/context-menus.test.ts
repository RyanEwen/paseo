import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { createExtensionContextMenus } from "./context-menus.js";

const id = "a".repeat(32);
const otherId = "b".repeat(32);
const params = {
  pageURL: "https://example.com/page",
  frameURL: "https://example.com/page",
  linkURL: "",
  srcURL: "",
  mediaType: "none" as const,
  isEditable: false,
  selectionText: "",
};
const context = { params, frameId: 0, tab: { id: 123, windowId: 12 }, isCurrent: () => true };
let directory: string;
let enabled = true;
let permitted = true;
const emit = vi.fn();
function options() {
  return {
    storagePath: path.join(directory, "context-menus.json"),
    getExtension(extensionId: string) {
      if (!enabled) {
        return null;
      }
      return {
        id: extensionId,
        name: "Fixture",
        manifest: { permissions: permitted ? ["contextMenus"] : [] },
      };
    },
    emit,
    onError: vi.fn(),
  };
}
function select(item: MenuItemConstructorOptions) {
  if (!item.click) {
    throw new Error("Menu action is missing");
  }
  Reflect.apply(item.click, undefined, []);
}
function children(item: MenuItemConstructorOptions) {
  if (!Array.isArray(item.submenu)) {
    throw new Error("Submenu is missing");
  }
  return item.submenu;
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "paseo-context-menus-"));
  enabled = true;
  permitted = true;
  emit.mockClear();
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("extension context menus", () => {
  it("groups extension items, nests children and formats selected text", async () => {
    const menus = createExtensionContextMenus(options());
    await menus.request(id, "contextMenus.create", ["root", { title: "Parent" }]);
    await menus.request(id, "contextMenus.create", [
      "child",
      { parentId: "root", title: "Search %s", contexts: ["selection"] },
    ]);
    await menus.request(id, "contextMenus.create", ["second", { title: "Other" }]);
    const items = menus.buildMenuItems({
      ...context,
      params: { ...params, selectionText: "fixture text" },
    });
    expect(items[0].label).toBe("Fixture");
    const root = children(items[0])[0];
    expect(children(root)[0].label).toBe("Search fixture text");
    select(children(root)[0]);
    expect(emit).toHaveBeenCalledWith(
      id,
      "contextMenus.onClicked",
      expect.objectContaining({
        menuItemId: "child",
        parentMenuItemId: "root",
        selectionText: "fixture text",
        frameId: 0,
      }),
      context.tab,
    );
  });

  it("enforces permission, independent IDs and parent ownership", async () => {
    const menus = createExtensionContextMenus(options());
    permitted = false;
    await expect(
      menus.request(id, "contextMenus.create", ["same", { title: "First" }]),
    ).rejects.toThrow("contextMenus permission");
    permitted = true;
    await menus.request(id, "contextMenus.create", ["same", { title: "First" }]);
    await menus.request(otherId, "contextMenus.create", ["same", { title: "Second" }]);
    await expect(
      menus.request(id, "contextMenus.create", ["same", { title: "Duplicate" }]),
    ).rejects.toThrow("already exists");
    await expect(
      menus.request(id, "contextMenus.create", ["child", { title: "Child", parentId: "missing" }]),
    ).rejects.toThrow("parent");
  });

  it("filters context, document and target URL independently", async () => {
    const menus = createExtensionContextMenus(options());
    await menus.request(id, "contextMenus.create", [
      "link",
      {
        title: "Link",
        contexts: ["link"],
        documentUrlPatterns: ["https://example.com/*"],
        targetUrlPatterns: ["https://target.test/*"],
      },
    ]);
    expect(menus.buildMenuItems(context)).toEqual([]);
    const linked = { ...context, params: { ...params, linkURL: "https://target.test/a" } };
    expect(menus.buildMenuItems(linked)[0].label).toBe("Link");
    expect(
      menus.buildMenuItems({
        ...linked,
        params: { ...linked.params, frameURL: "https://other.test/" },
      }),
    ).toEqual([]);
    expect(
      menus.buildMenuItems({
        ...linked,
        params: { ...linked.params, linkURL: "https://wrong.test/" },
      }),
    ).toEqual([]);
  });

  it("uses the eligible target when an image is nested inside a link", async () => {
    const menus = createExtensionContextMenus(options());
    await menus.request(id, "contextMenus.create", [
      "target",
      {
        title: "Target",
        contexts: ["image"],
        targetUrlPatterns: ["https://image.test/*"],
      },
    ]);
    const linkedImage = {
      ...context,
      params: {
        ...params,
        mediaType: "image" as const,
        linkURL: "https://link.test/path",
        srcURL: "https://image.test/image.png",
      },
    };
    expect(menus.buildMenuItems(linkedImage)[0].label).toBe("Target");
    await menus.request(id, "contextMenus.update", ["target", { contexts: ["link"] }]);
    expect(menus.buildMenuItems(linkedImage)).toEqual([]);
    await menus.request(id, "contextMenus.update", [
      "target",
      { targetUrlPatterns: ["https://link.test/*"] },
    ]);
    expect(menus.buildMenuItems(linkedImage)[0].label).toBe("Target");
    await menus.request(id, "contextMenus.update", [
      "target",
      { contexts: ["all"], targetUrlPatterns: ["https://image.test/*"] },
    ]);
    expect(menus.buildMenuItems(linkedImage)[0].label).toBe("Target");
  });

  it("rejects parent cycles and invalid match patterns without changing the tree", async () => {
    const menus = createExtensionContextMenus(options());
    await menus.request(id, "contextMenus.create", ["root", { title: "Root" }]);
    await menus.request(id, "contextMenus.create", ["child", { title: "Child", parentId: "root" }]);
    await expect(
      menus.request(id, "contextMenus.update", ["root", { parentId: "child" }]),
    ).rejects.toThrow("ancestor");
    await expect(
      menus.request(id, "contextMenus.update", ["root", { documentUrlPatterns: ["invalid"] }]),
    ).rejects.toThrow("pattern");
    expect(menus.buildMenuItems(context)[0].label).toBe("Root");
  });

  it("updates visibility and recursively removes children", async () => {
    const menus = createExtensionContextMenus(options());
    await menus.request(id, "contextMenus.create", ["root", { title: "Root" }]);
    await menus.request(id, "contextMenus.create", ["child", { title: "Child", parentId: "root" }]);
    await menus.request(id, "contextMenus.update", ["root", { visible: false }]);
    expect(menus.buildMenuItems(context)).toEqual([]);
    await menus.request(id, "contextMenus.remove", ["root"]);
    await expect(
      menus.request(id, "contextMenus.update", ["child", { title: "Renamed" }]),
    ).rejects.toThrow("does not exist");
    await menus.request(id, "contextMenus.create", ["new", { title: "New" }]);
    await menus.request(id, "contextMenus.removeAll", []);
    expect(menus.buildMenuItems(context)).toEqual([]);
  });

  it("persists restart state, hides disabled extensions, and explicitly forgets uninstalls", async () => {
    const menus = createExtensionContextMenus(options());
    await menus.request(id, "contextMenus.create", ["persisted", { title: "Saved" }]);
    const restored = createExtensionContextMenus(options());
    await restored.ready();
    expect(restored.buildMenuItems(context)[0].label).toBe("Saved");
    enabled = false;
    expect(restored.buildMenuItems(context)).toEqual([]);
    enabled = true;
    expect(restored.buildMenuItems(context)[0].label).toBe("Saved");
    await restored.forgetExtension(id);
    expect(JSON.parse(await readFile(options().storagePath, "utf8"))).toEqual({});
  });

  it("does not deliver stale menu selections after removal or navigation", async () => {
    const menus = createExtensionContextMenus(options());
    await menus.request(id, "contextMenus.create", ["action", { title: "Action" }]);
    const stale = menus.buildMenuItems(context)[0];
    await menus.request(id, "contextMenus.remove", ["action"]);
    select(stale);
    expect(emit).not.toHaveBeenCalled();
    await menus.request(id, "contextMenus.create", ["action", { title: "Action" }]);
    select(menus.buildMenuItems({ ...context, isCurrent: () => false })[0]);
    expect(emit).not.toHaveBeenCalled();
  });

  it("persists checkbox transitions and dispatches Chrome checked metadata", async () => {
    const menus = createExtensionContextMenus(options());
    await menus.request(id, "contextMenus.create", [
      "toggle",
      { title: "Toggle", type: "checkbox" },
    ]);
    select(menus.buildMenuItems(context)[0]);
    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith(
        id,
        "contextMenus.onClicked",
        expect.objectContaining({ checked: true, wasChecked: false }),
        context.tab,
      ),
    );
    expect(menus.buildMenuItems(context)[0].checked).toBe(true);
  });

  it("uses updated parent and checked state when an already displayed item is selected", async () => {
    const menus = createExtensionContextMenus(options());
    await menus.request(id, "contextMenus.create", ["parent", { title: "Parent" }]);
    await menus.request(id, "contextMenus.create", [
      "toggle",
      { title: "Toggle", type: "checkbox" },
    ]);
    const stale = children(menus.buildMenuItems(context)[0])[1];
    await menus.request(id, "contextMenus.update", [
      "toggle",
      { parentId: "parent", checked: true },
    ]);
    select(stale);
    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith(
        id,
        "contextMenus.onClicked",
        expect.objectContaining({ parentMenuItemId: "parent", wasChecked: true, checked: false }),
        context.tab,
      ),
    );
  });

  it("keeps unreadable menu storage intact across retries", async () => {
    await writeFile(options().storagePath, "corrupt fixture");
    const menus = createExtensionContextMenus(options());
    await expect(menus.ready()).rejects.toThrow();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        menus.request(id, "contextMenus.create", ["new", { title: "New" }]),
      ).rejects.toThrow();
    }
    expect(await readFile(options().storagePath, "utf8")).toBe("corrupt fixture");
  });

  it("reports failures after permission revocation to the visible native action error port", async () => {
    const configuration = options();
    const menus = createExtensionContextMenus(configuration);
    await menus.request(id, "contextMenus.create", ["action", { title: "Action" }]);
    const stale = menus.buildMenuItems(context)[0];
    permitted = false;
    select(stale);
    await vi.waitFor(() => expect(configuration.onError).toHaveBeenCalledWith(expect.any(Error)));
    expect(emit).not.toHaveBeenCalled();
  });

  it("radio selection clears only adjacent sibling radio items", async () => {
    const menus = createExtensionContextMenus(options());
    await menus.request(id, "contextMenus.create", [
      "one",
      { title: "One", type: "radio", checked: true },
    ]);
    await menus.request(id, "contextMenus.create", ["two", { title: "Two", type: "radio" }]);
    await menus.request(id, "contextMenus.create", ["separator", { type: "separator" }]);
    await menus.request(id, "contextMenus.create", [
      "three",
      { title: "Three", type: "radio", checked: true },
    ]);
    const items = children(menus.buildMenuItems(context)[0]);
    select(items[1]);
    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    const after = children(menus.buildMenuItems(context)[0]);
    expect(after.map((item) => item.checked)).toEqual([false, true, false, true]);
  });
});
