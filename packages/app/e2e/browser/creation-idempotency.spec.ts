import type { createCreationScenario } from "../support/helpers/creation";
import { expect } from "../support/fixtures";
import { test } from "../support/creation-fixtures";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildStartupGatePlugin } from "../support/helpers/startup-gate-plugin";

test("background naming cannot consume the workspace startup failure", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-startup-gate-"));
  const gate = path.join(directory, "startup.txt");
  interface Request {
    reason: string;
    workspaceId: string | null;
  }
  let before!: (input: { request: Request }) => Promise<Request>;
  try {
    // Execute the same generated plugin as the daemon, using a real command file.
    const source = Buffer.from(buildStartupGatePlugin(gate)).toString("base64");
    const plugin = await import(`data:text/javascript;base64,${source}`);
    plugin.default({
      before: (name: string, callback: typeof before) => {
        expect(name).toBe("agent.session_open");
        before = callback;
      },
    });
    await writeFile(gate, "fail");

    // Force the competing internal startup to arrive first, regardless of scheduler timing.
    const internal = { reason: "create", workspaceId: null };
    expect(await before({ request: internal })).toEqual(internal);
    expect(await readFile(gate, "utf8")).toBe("fail");

    const foreground = { reason: "create", workspaceId: "workspace" };
    await expect(before({ request: foreground })).rejects.toThrow(
      "Creation startup failed for test",
    );
    await expect(readFile(gate, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await before({ request: foreground })).toEqual(foreground);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const isolation of ["local", "worktree"] as const) {
  test(`repeated Create clicks before a render create only one ${isolation} workspace`, async ({
    creation,
  }) => {
    await creation.openWorkspaceForm(isolation);
    await creation.submitRepeatedly("Create");
    await creation.expectOneCreatedWorkspace();
  });
}

test("repeated Send clicks before a render create only one agent", async ({ creation }) => {
  await creation.openAgentDraft();
  await creation.submitRepeatedly("Send message", "Start exactly one agent for this prompt.");
  await creation.expectPromptVisible();
  await creation.expectAgentCount(1);
});

test("retrying the app's agent creation returns the same agent for every attempt", async ({
  creation,
  agentRetries,
}) => {
  await creation.openAgentDraft();
  await creation.submitPrompt("Start exactly one agent for this prompt.");
  expect(new Set(await agentRetries.completedAgentIds()).size).toBe(1);
  await creation.expectAgentCount(1);
});

test("the first prompt still names an agent created with a receipt", async ({ creation }) => {
  await creation.openAgentDraft();
  await creation.submitPrompt("Name this new agent from its first prompt.");
  await creation.expectPromptVisible();
  await creation.expectAgentTitle("Name this new agent from its first prompt.");
});

test("reconnecting after a lost creation response recovers the agent and initial message", async ({
  creation,
  promptRetry,
}) => {
  await creation.openAgentDraft();
  promptRetry.holdAcknowledgement();
  await creation.submitPrompt("Deliver this initial prompt once.");
  await promptRetry.waitForDeliveredPrompt();
  await promptRetry.disconnectAndReconnect();
  await promptRetry.expectSameAgentAndMessage();
  await creation.expectAgentCount(1);
});

test("a remounted draft reconciles its original creation after reconnect", async ({
  creation,
  promptRetry,
}) => {
  await creation.openAgentDraft();
  promptRetry.holdAcknowledgement();
  await creation.submitPrompt("Deliver this initial prompt once.");
  await promptRetry.waitForDeliveredPrompt();
  await creation.evictAndReturnToDraft();
  await creation.expectPromptVisible("Deliver this initial prompt once.");
  await promptRetry.disconnectAndReconnect();
  await promptRetry.expectSameAgentAndMessage();
  await creation.expectAgentCount(1);
});

test("repeated new-workspace prompt submissions create one workspace and one agent", async ({
  creation,
}) => {
  await creation.openWorkspaceForm("local");
  await creation.submitRepeatedly("Create", "Start one agent in one new workspace.");
  await creation.expectPromptVisible();
  await creation.expectOneCreatedWorkspace();
  await creation.expectAgentCount(1);
});

test("separate drafts can intentionally create two agents in the same workspace", async ({
  creation,
  delayedCreation,
}) => {
  await creation.openAgentDraft();
  await creation.submitPrompt("Start the first agent.");
  await creation.expectPromptVisible("Start the first agent.");
  await delayedCreation.waitForDelayedCreatedStatus();
  await creation.startAnotherDraft();
  await creation.submitPrompt("Start the second agent.");
  await creation.expectPromptVisible("Start the second agent.");
  await delayedCreation.waitForDelayedCreatedStatus();
  delayedCreation.release();
  await creation.expectAgentCount(2);
});

test("new workspace navigation and optimistic prompt precede agent initialization", async ({
  creation,
  startup,
  delayedCreation,
}) => {
  await creation.openWorkspaceForm("worktree");
  await creation.submitPrompt("Show this prompt while the agent is starting.", "Create");
  await creation.expectAgentStillStarting();
  delayedCreation.expectSingleWorkspaceIntent();
  delayedCreation.release();
  await startup.release();
  await creation.expectOneCreatedWorkspace();
  await creation.expectAgentCount(1);
});

for (const scenario of [
  { suffix: "", prepare: async () => {} },
  {
    suffix: " after remount",
    prepare: async (creation: Awaited<ReturnType<typeof createCreationScenario>>) =>
      creation.evictAndReturnToDraft(),
  },
]) {
  test(`retrying failed agent initialization preserves its workspace${scenario.suffix}`, async ({
    creation,
    startup,
  }) => {
    await creation.openWorkspaceForm("local");
    await creation.submitPrompt("Retry this workspace and agent together.", "Create");
    await creation.expectAgentStillStarting();
    await startup.fail();
    await creation.expectStartupFailure();
    await creation.expectOneCreatedWorkspace();
    await scenario.prepare(creation);
    await creation.submitPrompt("Retry this workspace and agent together.");
    await creation.expectAgentCount(1);
  });
}
