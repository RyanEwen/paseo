import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isMainModule } from "./is-main-module.mjs";

const checklist =
  "Keep fork documentation aligned with the behavior you change. Review the marked Paseo++ " +
  "README overview, Settings > Paseo++ (including localized labels/help and screenshot examples), " +
  "and the developer document that owns the subject. Identify differences from current upstream; " +
  "do not advertise stock features or unimplemented work. Update stale claims and screenshots, " +
  "or explain why the affected surfaces remain accurate. Do not make cosmetic edits just to " +
  "prove review, change unrelated settings, or overwrite another agent's work.";

/** Only repo source and documentation require this review; ignore generated hook state. */
export function isDocumentationRelevant(path) {
  return (
    path === "README.md" ||
    path === "CLAUDE.md" ||
    /^(packages|plugins|patches|scripts|docs|\.github)\//.test(path)
  );
}

/** Narrow the developer-doc pointers while keeping user-facing coverage explicit. */
export function reviewContext(paths = []) {
  const docs = new Set(["docs/release.md#fork-overview-review"]);
  for (const path of paths) {
    if (/sidebar|menu|settings/.test(path)) docs.add("docs/menus.md");
    if (/agent-stream|message|timeline/.test(path)) docs.add("docs/timeline-sync.md");
    if (/workspace|worktree/.test(path)) docs.add("docs/data-model.md");
    if (/app-updates|android|distribution|fork-preview/.test(path)) docs.add("docs/android.md");
    if (/protocol|sync/.test(path)) docs.add("docs/protocol-compatibility.md");
    if (/plugin/.test(path)) docs.add("docs/plugins.md");
    if (/browser/.test(path)) docs.add("docs/browser-capture-harness.md");
  }
  const files = paths.length
    ? ` Changed since this session's review baseline: ${paths.slice(0, 15).join(", ")}${paths.length > 15 ? ", ..." : ""}.`
    : "";
  return `${checklist}${files} Start with ${[...docs].join(", ")} and follow its owning-doc links.`;
}

/** Request one review pass, not a permanent block or an infinite Stop continuation loop. */
export function hookDecision(event, changes, alreadyReminded = false, alreadyContinued = false) {
  const name = event.hook_event_name;
  if (name === "SessionStart") {
    return { hookSpecificOutput: { hookEventName: name, additionalContext: reviewContext() } };
  }
  if (changes.length === 0) return {};
  if (name === "PostToolUse" && !alreadyReminded) {
    return {
      hookSpecificOutput: { hookEventName: name, additionalContext: reviewContext(changes) },
    };
  }
  if (name === "Stop" && !event.stop_hook_active && !alreadyContinued) {
    return {
      decision: "block",
      reason:
        `Before completing this turn, do one documentation consistency review. ${reviewContext(changes)} ` +
        "This is a documentation review only; it does not authorize commits, releases, browser controls, " +
        "service changes, or work the user paused. Summarize corrections or why no documentation change is needed.",
    };
  }
  return {};
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Read Git facts only. All mutation is confined to ignored checkout-local hook state. */
function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 3000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function fileHash(root, path) {
  const filename = join(root, path);
  return existsSync(filename) ? digest(readFileSync(filename)) : null;
}

function dirtyPaths(root, head) {
  const changed = git(root, ["diff", "--name-only", "-z", head]);
  const created = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return [...new Set(`${changed}\0${created}`.split("\0").filter(isDocumentationRelevant))];
}

/** Scope baselines to session, transcript and checkout so sibling worktrees never share a review. */
export function stateKey(event, root) {
  return digest(JSON.stringify([event.session_id ?? "unknown", event.transcript_path ?? "", root]));
}

/** Compare real content against session-start content, including dirty files already present then. */
export function runHook(event) {
  const root = git(resolve(event.cwd || process.cwd()), ["rev-parse", "--show-toplevel"]).trim();
  const statePath = join(root, ".dev", "codex-doc-review", `${stateKey(event, root)}.json`);
  let state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
  if (!state) {
    const head = git(root, ["rev-parse", "HEAD"]).trim();
    const baseline =
      event.hook_event_name === "SessionStart"
        ? Object.fromEntries(dirtyPaths(root, head).map((path) => [path, fileHash(root, path)]))
        : {};
    state = { head, baseline, seen: {}, remindedTurn: null, continuedTurn: null };
  }
  if (!/^[a-f0-9]{40,64}$/.test(state.head)) throw new Error("Invalid hook baseline revision.");
  const candidates = [...new Set([...dirtyPaths(root, state.head), ...Object.keys(state.seen)])];
  const current = {};
  const changes = [];
  for (const path of candidates) {
    if (!Object.hasOwn(state.baseline, path)) {
      try {
        state.baseline[path] = digest(
          execFileSync("git", ["show", `${state.head}:${path}`], {
            cwd: root,
            timeout: 3000,
            stdio: ["ignore", "pipe", "ignore"],
            maxBuffer: 64 * 1024 * 1024,
          }),
        );
      } catch {
        state.baseline[path] = null;
      }
    }
    current[path] = fileHash(root, path);
    if (current[path] !== state.baseline[path]) changes.push(path);
  }
  changes.sort();
  const turn = event.turn_id ?? "no-turn-id";
  const result = hookDecision(
    event,
    changes,
    state.remindedTurn === turn,
    state.continuedTurn === turn,
  );
  if (event.hook_event_name === "PostToolUse" && result.hookSpecificOutput)
    state.remindedTurn = turn;
  if (event.hook_event_name === "Stop") {
    if (result.decision === "block") state.continuedTurn = turn;
    else {
      state.baseline = { ...state.baseline, ...current };
      state.head = git(root, ["rev-parse", "HEAD"]).trim();
    }
  }
  state.seen = current;
  mkdirSync(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`);
  renameSync(temporary, statePath);
  return result;
}

/** Emit supported hook JSON only; failures warn rather than interfering with unrelated agent work. */
function main() {
  try {
    const event = JSON.parse(readFileSync(0, "utf8"));
    console.log(JSON.stringify(runHook(event)));
  } catch {
    console.log(
      JSON.stringify({
        systemMessage:
          "Paseo documentation hook could not inspect this checkout. Review README, Paseo++ settings and owning developer docs manually.",
      }),
    );
  }
}

if (isMainModule(import.meta.url)) main();
