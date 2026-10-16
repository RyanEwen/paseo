import { describe, expect, it } from "vitest";
import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";
import type { PrHint } from "@/git/pr-hint";
import { DEFAULT_SIDEBAR_CHECKS_DISPLAY } from "@/components/sidebar/display-preferences/checks-display";
import {
  DEFAULT_SIDEBAR_ROW_ITEMS,
  parseSidebarRowItems,
} from "@/components/sidebar/display-preferences/row-items";
import { selectMetaRowItems } from "./meta-items";
import type { WorkspaceServiceSummary } from "./service-summary";

const PR_HINT: PrHint = {
  url: "https://github.com/acme/app/pull/7",
  number: 7,
  state: "open",
  forge: "github",
  checksStatus: "success",
};

const SERVICE: WorkspaceServiceSummary = { name: "web", health: null };

const LABELS: WorkspaceLabelDefinition[] = [{ name: "Urgent", color: "red" }];

function select(overrides: Partial<Parameters<typeof selectMetaRowItems>[0]> = {}) {
  return selectMetaRowItems({
    currentBranch: "feature/sidebar-badges",
    projectName: "Paseo",
    hasHostBadge: true,
    prHint: PR_HINT,
    serviceSummary: SERVICE,
    labels: LABELS,
    visible: DEFAULT_SIDEBAR_ROW_ITEMS,
    checksDisplay: DEFAULT_SIDEBAR_CHECKS_DISPLAY,
    ...overrides,
  });
}

const kinds = (items: ReturnType<typeof selectMetaRowItems>) => items.map((item) => item.kind);

describe("selectMetaRowItems", () => {
  it("shows project identity but omits available branch metadata by default", () => {
    expect(select().filter((item) => item.kind === "project" || item.kind === "branch")).toEqual([
      { kind: "project", name: "Paseo" },
    ]);
  });

  it("retains a saved enabled branch after the project identity", () => {
    expect(select({ visible: parseSidebarRowItems({ branch: true }) }).slice(0, 2)).toEqual([
      { kind: "project", name: "Paseo" },
      { kind: "branch", name: "feature/sidebar-badges" },
    ]);
  });

  it("reads identity, then the change, then its state, then what is running, then labels", () => {
    expect(kinds(select())).toEqual([
      "project",
      "host",
      "changeRequest",
      "checks",
      "services",
      "labels",
    ]);
  });

  it("omits what the workspace does not have", () => {
    expect(
      kinds(
        select({
          currentBranch: null,
          projectName: null,
          hasHostBadge: false,
          prHint: null,
          serviceSummary: null,
          labels: [],
        }),
      ),
    ).toEqual([]);
  });

  it("only draws identity badges when enabled and available", () => {
    const visible = { ...DEFAULT_SIDEBAR_ROW_ITEMS, branch: true, project: true };
    expect(kinds(select({ currentBranch: null, projectName: null, visible }))).toEqual([
      "host",
      "changeRequest",
      "checks",
      "services",
      "labels",
    ]);
  });

  it("carries every label as one item, so the line keeps one separator however many there are", () => {
    const labels: WorkspaceLabelDefinition[] = [
      { name: "Urgent", color: "red" },
      { name: "Backend", color: "sky" },
    ];
    expect(select({ labels }).at(-1)).toEqual({ kind: "labels", labels });
  });

  it.each([
    ["project", ["branch", "host", "changeRequest", "checks", "services", "labels"]],
    ["branch", ["project", "host", "changeRequest", "checks", "services", "labels"]],
    ["changeRequest", ["project", "branch", "host", "checks", "services", "labels"]],
    ["services", ["project", "branch", "host", "changeRequest", "checks", "labels"]],
    ["labels", ["project", "branch", "host", "changeRequest", "checks", "services"]],
  ] as const)("drops %s and only %s when it is switched off", (item, expected) => {
    expect(
      kinds(select({ visible: { ...DEFAULT_SIDEBAR_ROW_ITEMS, branch: true, [item]: false } })),
    ).toEqual(expected);
  });

  it("drops checks and only checks when they are hidden", () => {
    expect(kinds(select({ checksDisplay: "none" }))).toEqual([
      "project",
      "host",
      "changeRequest",
      "services",
      "labels",
    ]);
  });

  it("keeps checks when the change request is hidden", () => {
    // Each control answers for itself. A checks setting that drew nothing because a different
    // switch was off would be lying about its own state.
    const items = select({ visible: { ...DEFAULT_SIDEBAR_ROW_ITEMS, changeRequest: false } });
    expect(kinds(items)).toEqual(["project", "host", "checks", "services", "labels"]);
  });

  it("draws nothing for checks when both are off", () => {
    const items = select({
      visible: { ...DEFAULT_SIDEBAR_ROW_ITEMS, changeRequest: false },
      checksDisplay: "none",
    });
    expect(kinds(items)).toEqual(["project", "host", "services", "labels"]);
  });

  it("carries the resolved check summary rather than the raw hint", () => {
    const checks = select().find((item) => item.kind === "checks");
    expect(checks).toEqual({
      kind: "checks",
      summary: { state: "passed", completed: 1, total: 1 },
      label: true,
    });
  });

  it("keeps the check summary but drops its word when only the icon is wanted", () => {
    const checks = select({ checksDisplay: "icon" }).find((item) => item.kind === "checks");
    expect(checks).toEqual({
      kind: "checks",
      summary: { state: "passed", completed: 1, total: 1 },
      label: false,
    });
  });

  it("keeps a change request whose forge reports no checks", () => {
    const items = select({ prHint: { ...PR_HINT, checksStatus: undefined } });
    expect(kinds(items)).toEqual(["project", "host", "changeRequest", "services", "labels"]);
  });
});
