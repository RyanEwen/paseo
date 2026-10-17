# Agent documentation review

Codex's project hooks in `.codex/hooks.json` remind agents to keep the fork README, Paseo++ settings
and owning developer docs aligned. `scripts/codex-docs-hook.mjs` supplies the review checklist at
session start and after relevant changes, then requests one review pass before a turn finishes.

Review actual behavior and its differences from current upstream. Correct stale descriptions,
platform claims and screenshot examples. When a surface does not need an edit, explain why it
remains accurate. Do not change prose just to satisfy the hook or modify another agent's work.

The hook tracks content changes against a session baseline. Files already dirty when the session
starts do not count as new agent changes. State is local to the checkout and session, under ignored
`.dev/codex-doc-review/`. It stores file hashes, not file content or conversation transcripts. No
commit, staging, service, release or settings operation is performed by the hook.

The Stop hook requests at most one continuation per turn and respects Codex's `stop_hook_active`
guard. It requests a semantic review; it cannot prove that descriptions are correct. Hook failures
show a warning instead of blocking unrelated work. Other agent providers do not run these Codex
hooks.

## Activation

Start a new Codex session in the checkout and review the project hooks in `/hooks`. Codex requires
trust in the exact hook definition before executing it; changed definitions need another review.
Do not edit stored trust hashes or bypass that review. Existing sessions are not assumed to reload
new hooks automatically. See [the official hooks guide](https://learn.chatgpt.com/docs/hooks).

The existing README review check in CI stays independent of this agent hook.
