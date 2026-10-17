/** @vitest-environment jsdom */
import React, { act } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useDraftStore,
  waitForDraftPersistence,
  flushDraftPersistStorage,
} from "@/stores/draft-store";
import { DRAFT_STORE_VERSION } from "@/stores/draft-store/state";
import type { AttachmentMetadata, ComposerAttachment } from "@/attachments/types";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";

const { asyncStorage, draftStorageRead } = vi.hoisted(() => ({
  asyncStorage: new Map<string, string>(),
  draftStorageRead: { current: null as null | (() => Promise<string | null>) },
}));

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) =>
      key === "paseo-drafts" && draftStorageRead.current
        ? draftStorageRead.current()
        : (asyncStorage.get(key) ?? null),
    setItem: async (key: string, value: string) => {
      asyncStorage.set(key, value);
    },
    removeItem: async (key: string) => {
      asyncStorage.delete(key);
    },
  },
}));

vi.mock("@/attachments/service", () => ({
  garbageCollectAttachments: async () => undefined,
}));

vi.mock("@/hooks/use-agent-form-state", () => ({
  useAgentFormState: () => ({
    selectedServerId: "host-1",
    selectedProvider: "codex",
    setProviderFromUser: () => undefined,
    selectedMode: "auto",
    setModeFromUser: () => undefined,
    selectedModel: "",
    setModelFromUser: () => undefined,
    selectedThinkingOptionId: "",
    setThinkingOptionFromUser: () => undefined,
    workingDir: "/repo",
    providerDefinitions: [{ id: "codex", label: "Codex", modes: [{ id: "auto", label: "Auto" }] }],
    providerDefinitionMap: new Map(),
    agentDefinition: undefined,
    modeOptions: [{ id: "auto", label: "Auto" }],
    availableModels: [
      {
        provider: "codex",
        id: "gpt-5.4",
        label: "gpt-5.4",
        isDefault: true,
        defaultThinkingOptionId: "high",
        thinkingOptions: [
          { id: "medium", label: "Medium" },
          { id: "high", label: "High", isDefault: true },
        ],
      },
    ],
    allProviderModels: new Map([
      [
        "codex",
        [
          {
            provider: "codex",
            id: "gpt-5.4",
            label: "gpt-5.4",
            isDefault: true,
            defaultThinkingOptionId: "high",
            thinkingOptions: [
              { id: "medium", label: "Medium" },
              { id: "high", label: "High", isDefault: true },
            ],
          },
        ],
      ],
    ]),
    modelSelectorProviders: [
      {
        id: "codex",
        label: "Codex",
        modelSelection: {
          kind: "models",
          rows: [
            {
              favoriteKey: "codex:gpt-5.4",
              provider: "codex",
              providerLabel: "Codex",
              modelId: "gpt-5.4",
              modelLabel: "gpt-5.4",
              isDefault: true,
            },
          ],
        },
      },
    ],
    isAllModelsLoading: false,
    isProviderModelsRefreshing: false,
    availableThinkingOptions: [
      { id: "medium", label: "Medium" },
      { id: "high", label: "High", isDefault: true },
    ],
    isModelLoading: false,
    modelError: null,
    refreshProviderModels: () => undefined,
    setProviderAndModelFromUser: () => undefined,
    workingDirIsEmpty: false,
    persistFormPreferences: async () => undefined,
  }),
}));

const pendingDraftReads = new Set<() => Promise<void>>();
const mountedRoots = new Set<Root>();
function createTestRoot(container: HTMLElement): Root {
  const root = createRoot(container);
  mountedRoots.add(root);
  return root;
}

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots) root.unmount();
    mountedRoots.clear();
    for (const finish of pendingDraftReads) await finish();
    pendingDraftReads.clear();
    draftStorageRead.current = null;
  });
});

let useAgentInputDraft: typeof import("./input-draft").useAgentInputDraft;
type DraftRecordForTest = ReturnType<typeof useDraftStore.getState>["drafts"][string];

beforeAll(async () => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    configurable: true,
  });

  ({ useAgentInputDraft } = await import("./input-draft"));
});

describe("useAgentInputDraft live contract", () => {
  beforeEach(() => {
    asyncStorage.clear();
    document.body.innerHTML = "<div id='root'></div>";
    localStorage.clear();

    useDraftStore.setState({
      drafts: {},
      createModalDraft: null,
      attachmentFocusRequestByDraftKey: {},
    });
  });

  it("hydrates persisted text and attachments and returns draft-mode composer state for a caller-provided key", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "attachment-1",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/1",
      createdAt: 1,
      fileName: "image.png",
      byteSize: 128,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    function Probe({ draftKey }: { draftKey: string }) {
      latest = useAgentInputDraft({
        draftKey,
        composer: {
          initialServerId: "host-1",
          isVisible: true,
          lockedWorkingDir: "/repo",
        },
      });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    let root: Root | null = createTestRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Probe draftKey="draft:setup" />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().composerState?.agentControls.selectedProvider).toBe("codex");
    expect(getLatest().composerState?.commandDraft).toEqual({
      status: "ready",
      config: {
        provider: "codex",
        cwd: "/repo",
        modeId: "auto",
        model: "gpt-5.4",
        thinkingOptionId: "high",
      },
    });

    const hydratedTextReplacement = getLatest().textReplacement;

    await act(async () => {
      getLatest().editText("hello world");
      getLatest().setAttachments([{ kind: "image", metadata: image }]);
    });

    expect(getLatest().textReplacement).toBe(hydratedTextReplacement);

    await act(async () => {
      getLatest().replaceText("replacement text");
    });

    expect(getLatest().textReplacement).not.toBe(hydratedTextReplacement);
    expect(getLatest().textReplacement.text).toBe("replacement text");

    await act(async () => {
      getLatest().editText("hello world");
    });

    await act(async () => {
      root!.unmount();
    });

    root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe draftKey="draft:setup" />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().textSource.getSnapshot()).toBe("hello world");
    expect(getLatest().attachments).toEqual([{ kind: "image", metadata: image }]);
  });

  it("migrates legacy image drafts to image attachments on hydration", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "legacy-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/legacy-image",
      createdAt: 10,
      fileName: "legacy.png",
      byteSize: 512,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    useDraftStore.setState({
      drafts: {
        "draft:legacy": {
          input: {
            text: "legacy text",
            images: [image],
          },
          lifecycle: "active",
          updatedAt: Date.now(),
          version: 1,
        } as unknown as DraftRecordForTest,
      },
      createModalDraft: null,
    });

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:legacy" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().textSource.getSnapshot()).toBe("legacy text");
    expect(getLatest().attachments).toEqual([{ kind: "image", metadata: image }]);
    expect(useDraftStore.getState().drafts["draft:legacy"]?.input).toEqual({
      text: "legacy text",
      attachments: [{ kind: "image", metadata: image }],
    });
  });

  it("hydrates drafts saved by old builds with cwd", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const githubIssue: ComposerAttachment = {
      kind: "github_issue",
      item: {
        kind: "issue",
        number: 42,
        title: "Unify attachments",
        url: "https://github.com/paseo/paseo/issues/42",
        state: "open",
        body: "body",
        labels: ["composer"],
      },
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    useDraftStore.setState({
      drafts: {
        "draft:new-shape": {
          input: {
            text: "new text",
            attachments: [githubIssue],
            cwd: "/persisted",
          },
          lifecycle: "active",
          updatedAt: Date.now(),
          version: 1,
        } as unknown as DraftRecordForTest,
      },
      createModalDraft: null,
    });

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:new-shape" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().textSource.getSnapshot()).toBe("new text");
    expect(getLatest().attachments).toEqual([githubIssue]);

    await act(async () => {
      root.unmount();
    });

    expect(useDraftStore.getState().drafts["draft:new-shape"]?.input).toEqual({
      text: "new text",
      attachments: [githubIssue],
      cwd: "/persisted",
    });
  });

  it("updates and persists attachments through setAttachments", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "next-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/next-image",
      createdAt: 11,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    let renders = 0;
    function Probe() {
      renders += 1;
      latest = useAgentInputDraft({ draftKey: "draft:attachments" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      getLatest().editText("with attachment");
      getLatest().setAttachments([{ kind: "image", metadata: image }]);
    });

    expect(getLatest().attachments).toEqual([{ kind: "image", metadata: image }]);
    const readPersistedInput = () => useDraftStore.getState().drafts["draft:attachments"]?.input;
    await act(async () => {
      // Web text publication occurs after paint; attachments save immediately.
      await expect.poll(readPersistedInput).toEqual({
        text: "with attachment",
        attachments: [{ kind: "image", metadata: image }],
      });
    });
    const settledRenders = renders;
    const attached = getLatest().attachments;
    const source = getLatest().textSource;
    let textNotifications = 0;
    const unsubscribe = source.subscribe(() => {
      textNotifications += 1;
    });
    await act(async () => {
      getLatest().editText("with attachment\n");
      await expect.poll(source.getSnapshot).toBe("with attachment\n");
    });
    expect(renders).toBe(settledRenders);
    expect(getLatest().attachments).toBe(attached);
    expect(getLatest().textSource).toBe(source);
    expect(textNotifications).toBe(1);
    unsubscribe();
    await act(async () => {
      root.unmount();
    });
  });

  it("attaches to an unmounted legacy draft without losing its input", async () => {
    const image: AttachmentMetadata = {
      id: "legacy-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/legacy-image",
      createdAt: 10,
    };
    useDraftStore.setState({
      drafts: {
        "draft:legacy-workspace-file": {
          input: { text: "legacy text", images: [image] },
          lifecycle: "active",
          updatedAt: Date.now(),
          version: 1,
        } as unknown as DraftRecordForTest,
      },
    });

    await useDraftStore.getState().attachWorkspaceFile({
      draftKey: "draft:legacy-workspace-file",
      attachment: createWorkspaceFileAttachment({ path: "src/app.ts" }),
    });

    expect(useDraftStore.getState().getDraftInput("draft:legacy-workspace-file")).toEqual({
      text: "legacy text",
      attachments: [
        { kind: "image", metadata: image },
        createWorkspaceFileAttachment({ path: "src/app.ts" }),
      ],
    });
  });

  it("clear resets text and attachments", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "clear-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/clear-image",
      createdAt: 12,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:clear" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      getLatest().editText("queued message");
      getLatest().setAttachments([{ kind: "image", metadata: image }]);
    });

    await act(async () => {
      getLatest().clear("sent");
    });

    expect(getLatest().textSource.getSnapshot()).toBe("");
    expect(getLatest().attachments).toEqual([]);
    expect(useDraftStore.getState().drafts["draft:clear"]?.input).toEqual({
      text: "",
      attachments: [],
    });
  });

  it("clears drafts with sent and abandoned lifecycle tombstones", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const sentImage: AttachmentMetadata = {
      id: "attachment-sent",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/sent",
      createdAt: 2,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:lifecycle" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      getLatest().editText("queued message");
      getLatest().setAttachments([{ kind: "image", metadata: sentImage }]);
    });

    await act(async () => {
      getLatest().clear("sent");
    });

    expect(getLatest().textSource.getSnapshot()).toBe("");
    expect(getLatest().attachments).toEqual([]);
    expect(useDraftStore.getState().drafts["draft:lifecycle"]).toMatchObject({
      lifecycle: "sent",
      input: { text: "", attachments: [] },
    });

    await act(async () => {
      getLatest().editText("draft again");
    });

    await act(async () => {
      getLatest().clear("abandoned");
    });

    expect(useDraftStore.getState().drafts["draft:lifecycle"]).toMatchObject({
      lifecycle: "abandoned",
      input: { text: "", attachments: [] },
    });
  });
});

// Delay the actual backing read. Zustand validation, merge, completion and the hook remain real.
function delayDraftStorageRead(drafts: Record<string, DraftRecordForTest>) {
  const raw = JSON.stringify({
    state: { drafts, createModalDraft: null },
    version: DRAFT_STORE_VERSION,
  });
  let resolveRead!: (value: string | null) => void;
  let rejectRead!: (reason: Error) => void;
  const read = new Promise<string | null>((resolve, reject) => {
    resolveRead = resolve;
    rejectRead = reject;
  });
  draftStorageRead.current = () => read;
  const hydration = Promise.resolve(useDraftStore.persist.rehydrate());
  const finish = async () => {
    draftStorageRead.current = null;
    resolveRead(raw);
    await hydration;
  };
  pendingDraftReads.add(finish);
  return {
    finish,
    fail: async (error: Error) => {
      draftStorageRead.current = null;
      rejectRead(error);
      await hydration;
    },
  };
}

function persistedDraft(text: string): DraftRecordForTest {
  return {
    input: { text, attachments: [] },
    lifecycle: "active",
    updatedAt: Date.now(),
    version: 1,
  };
}

function mountHydrationProbe() {
  let latest: ReturnType<typeof useAgentInputDraft> | null = null;
  const replacements: string[] = [];
  function Probe({ draftKey }: { draftKey: string }) {
    latest = useAgentInputDraft({ draftKey });
    replacements.push(latest.textReplacement.text);
    return null;
  }
  const container = document.getElementById("root");
  if (!container) throw new Error("Missing root container");
  const root = createTestRoot(container);
  const client = new QueryClient();
  return {
    latest: () => {
      if (!latest) throw new Error("Missing hook result");
      return latest;
    },
    replacements,
    render: async (draftKey: string) => {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <Probe draftKey={draftKey} />
          </QueryClientProvider>,
        );
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      mountedRoots.delete(root);
    },
  };
}

function readLocalHydrationDraftText() {
  return useDraftStore.getState().drafts["draft:local"]?.input.text;
}

describe("useAgentInputDraft persistence completion", () => {
  beforeEach(async () => {
    await flushDraftPersistStorage();
    asyncStorage.clear();
    document.body.innerHTML = "<div id='root'></div>";
    useDraftStore.setState({
      drafts: {},
      createModalDraft: null,
      attachmentFocusRequestByDraftKey: {},
    });
    await flushDraftPersistStorage();
  });

  it("waits for a deferred persisted nonempty draft before publishing its replacement", async () => {
    const read = delayDraftStorageRead({
      "draft:delayed": persistedDraft("restored nonempty text"),
    });
    const probe = mountHydrationProbe();
    await probe.render("draft:delayed");
    expect(useDraftStore.persist.hasHydrated()).toBe(false);
    expect(probe.latest().isHydrated).toBe(false);
    const initial = probe.latest().textReplacement;
    await act(async () => {
      await read.finish();
    });
    expect(useDraftStore.persist.hasHydrated()).toBe(true);
    expect(probe.latest().isHydrated).toBe(true);
    expect(probe.latest().textReplacement).not.toBe(initial);
    expect(probe.latest().textReplacement.text).toBe("restored nonempty text");
    expect(probe.latest().textSource.getSnapshot()).toBe("restored nonempty text");
  });

  it.each([
    {
      name: "typing",
      apply: (draft: ReturnType<typeof useAgentInputDraft>) => draft.editText("new local text"),
      text: "new local text",
      lifecycle: "active",
    },
    {
      name: "explicit replacement",
      apply: (draft: ReturnType<typeof useAgentInputDraft>) => draft.replaceText("new replacement"),
      text: "new replacement",
      lifecycle: "active",
    },
    {
      name: "clear",
      apply: (draft: ReturnType<typeof useAgentInputDraft>) => draft.clear("sent"),
      text: "",
      lifecycle: "sent",
    },
  ])(
    "preserves $name committed while persistence is pending",
    async ({ apply, text, lifecycle }) => {
      const read = delayDraftStorageRead({
        "draft:local": persistedDraft("older stored text"),
        "draft:untouched": persistedDraft("other stored draft"),
      });
      const probe = mountHydrationProbe();
      await probe.render("draft:local");
      await act(async () => {
        apply(probe.latest());
        useDraftStore
          .getState()
          .saveCreateModalDraft({ text: "local modal draft", attachments: [] });
        await expect.poll(readLocalHydrationDraftText).toBe(text);
      });
      const replacement = probe.latest().textReplacement;
      await act(async () => {
        await read.finish();
      });
      expect(probe.latest().isHydrated).toBe(true);
      expect(probe.latest().textReplacement).toBe(replacement);
      expect(useDraftStore.getState().drafts["draft:local"]).toMatchObject({
        input: { text },
        lifecycle,
      });
      expect(useDraftStore.getState().getDraftInput("draft:untouched")?.text).toBe(
        "other stored draft",
      );
      expect(useDraftStore.getState().getCreateModalDraft()?.text).toBe("local modal draft");
    },
  );

  it("checkpoints the merged drafts and reads both back after a local write during hydration", async () => {
    const storedA = persistedDraft("A stored");
    const storedB = persistedDraft("B stored");
    const initialEnvelope = {
      state: { drafts: { "draft:a": storedA, "draft:b": storedB }, createModalDraft: null },
      version: DRAFT_STORE_VERSION,
    };
    // Seed only the backing storage; the real store is empty from beforeEach.
    asyncStorage.set("paseo-drafts", JSON.stringify(initialEnvelope));
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let capturedRead: string | null = null;
    draftStorageRead.current = async () => {
      // Capture the real backing value at read start, then hold its completion.
      capturedRead = asyncStorage.get("paseo-drafts") ?? null;
      await readGate;
      return capturedRead;
    };
    const hydration = Promise.resolve(useDraftStore.persist.rehydrate());
    const finishRead = async () => {
      draftStorageRead.current = null;
      releaseRead();
      await hydration;
    };
    pendingDraftReads.add(finishRead);
    expect(JSON.parse(capturedRead ?? "null")).toEqual(initialEnvelope);

    const probe = mountHydrationProbe();
    await probe.render("draft:a");
    expect(probe.latest().isHydrated).toBe(false);
    await act(async () => {
      probe.latest().replaceText("A local");
    });
    const localA = useDraftStore.getState().drafts["draft:a"];
    if (!localA) throw new Error("Expected the local draft write");
    expect(localA.input).toEqual({ text: "A local", attachments: [] });
    await flushDraftPersistStorage();
    // Establish the dangerous intermediate durable state, rather than assuming a write occurred.
    expect(JSON.parse(asyncStorage.get("paseo-drafts") ?? "null")).toEqual({
      state: { drafts: { "draft:a": localA }, createModalDraft: null },
      version: DRAFT_STORE_VERSION,
    });
    expect(useDraftStore.persist.hasHydrated()).toBe(false);

    await act(async () => {
      await finishRead();
    });
    expect(probe.latest().isHydrated).toBe(true);
    expect(useDraftStore.getState().drafts).toEqual({ "draft:a": localA, "draft:b": storedB });
    // No explicit setState/checkpoint injection: successful hydration's existing GC path queues it.
    await flushDraftPersistStorage();
    const mergedEnvelope = {
      state: { drafts: { "draft:a": localA, "draft:b": storedB }, createModalDraft: null },
      version: DRAFT_STORE_VERSION,
    };
    expect(JSON.parse(asyncStorage.get("paseo-drafts") ?? "null")).toEqual(mergedEnvelope);

    await probe.unmount();
    // Observe, without replacing, the normal backing getter on the next real rehydrate.
    const nextRead = vi.spyOn(AsyncStorage, "getItem");
    try {
      await act(async () => {
        await useDraftStore.persist.rehydrate();
      });
      expect(nextRead).toHaveBeenCalledWith("paseo-drafts");
    } finally {
      nextRead.mockRestore();
    }
    expect(useDraftStore.persist.hasHydrated()).toBe(true);
    const remounted = mountHydrationProbe();
    await remounted.render("draft:a");
    expect(remounted.latest().isHydrated).toBe(true);
    expect(remounted.latest().textReplacement.text).toBe("A local");
    await remounted.render("draft:b");
    expect(remounted.latest().isHydrated).toBe(true);
    expect(remounted.latest().textReplacement.text).toBe("B stored");
    expect(useDraftStore.getState().drafts).toEqual({ "draft:a": localA, "draft:b": storedB });
    expect(JSON.parse(asyncStorage.get("paseo-drafts") ?? "null")).toEqual(mergedEnvelope);
  });

  it("flushes an edit still queued after paint without publishing older restored text", async () => {
    const read = delayDraftStorageRead({ "draft:queued": persistedDraft("older stored text") });
    const probe = mountHydrationProbe();
    await probe.render("draft:queued");
    const replacement = probe.latest().textReplacement;
    await act(async () => {
      probe.latest().editText("queued local text");
      await read.finish();
    });
    expect(probe.latest().textSource.getSnapshot()).toBe("queued local text");
    expect(probe.latest().textReplacement).toBe(replacement);
    expect(probe.latest().isHydrated).toBe(true);
  });

  it("publishes only the current key when the key changes during the read", async () => {
    const read = delayDraftStorageRead({
      "draft:a": persistedDraft("A text"),
      "draft:b": persistedDraft("B text"),
    });
    const probe = mountHydrationProbe();
    await probe.render("draft:a");
    await probe.render("draft:b");
    await act(async () => {
      await read.finish();
    });
    expect(probe.latest().textReplacement.text).toBe("B text");
    expect(probe.latest().textReplacement.key.startsWith("draft:b:")).toBe(true);
    expect(probe.replacements).not.toContain("A text");
    expect(probe.latest().isHydrated).toBe(true);
  });

  it("does not publish to an unmounted hook when the read completes", async () => {
    const read = delayDraftStorageRead({ "draft:gone": persistedDraft("stored text") });
    const probe = mountHydrationProbe();
    await probe.render("draft:gone");
    const result = probe.latest();
    await probe.unmount();
    await act(async () => {
      await read.finish();
    });
    expect(probe.latest()).toBe(result);
    expect(probe.replacements).not.toContain("stored text");
    expect(useDraftStore.getState().getDraftInput("draft:gone")?.text).toBe("stored text");
  });

  it("settles a failed backing read without publishing empty or admitting auto-submit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const read = delayDraftStorageRead({ "draft:error": persistedDraft("stored text") });
      const probe = mountHydrationProbe();
      await probe.render("draft:error");
      const initial = probe.latest().textReplacement;
      const waiting = waitForDraftPersistence(new AbortController().signal);
      await act(async () => {
        await read.fail(new Error("read failed"));
      });
      await expect(waiting).resolves.toBe("failed");
      expect(useDraftStore.persist.hasHydrated()).toBe(false);
      expect(probe.latest().isHydrated).toBe(false);
      expect(probe.latest().textReplacement).toBe(initial);
      await expect(waitForDraftPersistence(new AbortController().signal)).resolves.toBe("failed");
    } finally {
      warn.mockRestore();
    }
  });

  it("releases the abort listener when its pending waiter is cancelled", async () => {
    const read = delayDraftStorageRead({});
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const waiting = waitForDraftPersistence(controller.signal);
    controller.abort();
    await expect(waiting).resolves.toBe("cancelled");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    await read.finish();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
