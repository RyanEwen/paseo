# Paseo++ settings verification

The settings page and preference contract remain uncommitted. The live human preview, installed
daemon and release state were not changed by this work.

## Preference contract

`AppSettings.paseoPlusPlus` is client-local and uses the existing settings storage. The canonical
schema is `packages/app/src/paseo-plus-plus/preferences.ts`. Every feature defaults to enabled.
Missing or malformed choices enable the feature; explicit saved Off choices remain Off. Reset uses
the same enabled defaults. Unknown future choices survive ordinary writes.

Consumers read `useAppSettings().settings.paseoPlusPlus.<key>`. Writers use a functional update:

```ts
await updateSettings((current) => ({
  paseoPlusPlus: { ...current.paseoPlusPlus, previousAgents: enabled },
}));
```

Functional saves are serialized per app query client. Failed writes leave effective cached settings
unchanged and release the write queue. The page disables duplicate submissions, shows pending state,
and keeps a retryable save error beside the affected control. The reusable save ownership hook
serves feature switches and all four Explorer controls. Loading or read errors disable Explorer
as well as feature controls; the page owns the shared read Retry.

| Key                            | Disabled behavior                                                           | Preserved state                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `stickyUserPrompts`            | Hide sticky copy and original arrows; stop its discovery and scrolling work | Chat hierarchy, draft, loaded messages and attachments; independent outline navigation |
| `previousAgents`               | Hide shared launch entry; dismiss and unmount its dialog                    | Archives, sessions, cached history and open tabs                                       |
| `sidebarActivityChips`         | Restore the collapsed-only aggregate icon                                   | Workspace status placement and saved sidebar configuration                             |
| `sidebarProjectEmphasis`       | Use normal project-title weight                                             | Names, colors and saved configuration                                                  |
| `sidebarBulkActions`           | Hide desktop controls and compact menu actions                              | Individual chevrons and stored collapse state                                          |
| `projectPinning`               | Hide project pin actions and ignore project pin priority/reorder            | Stored project pins and order, visible rows, global pin actions                        |
| `androidAutomaticUpdateChecks` | Remove automatic startup, resume and timer checks after hydration           | Manual check/install, notices, in-flight metadata completion and verification          |
| `sidebarWorkspaceTransitions`  | Stop position animation and use immediate layout                            | Existing drag, grouping, collapse and reduced-motion behavior                          |
| `sidebarProjectSelector`       | Restore Workspaces heading and existing Project filter menu                 | Multi-project allowlist, including offline project keys                                |

The Android automatic-check switch is shown only on Android. The other eight enable switches are
visible in browser fixtures. These switches are distinct from existing Explorer configuration
choices, whose saved values and defaults are retained.

## Settings ownership

Compared with the verified upstream merge parent `a1da1b8f2`, stock Sidebar gained only the fork's
Explorer component and its invocation in `b9149ada1`. Its four controls now live only on Paseo++:
initial Explorer opening (web), changed-file diff scope, default comparison and automatic comparison.
The existing controls, platform gate, disabled-comparison rule, persistence and runtime are reused.
Each Explorer save is awaited, with pending state and contextual error feedback. A failed save
retains the effective and durable value; submitting the intended value again retries it.
Stock Sidebar keeps upstream header/footer visibility and ordering controls.

The reviewed project selector consumer is integrated. Its owner qualified four browser cases and
ten focused cases, including multi-selection, pinned rows, compact sheets, reload, focus and saved
offline filter keys. The shared Display menu uses one settings subscription for both selector and
bulk-action gates.

Current Dev removed Electron extension support in `8553ec2be`. The draft follows that exact
committed removal and removes the stale README claim. No extension catalog or extension entry is
included on Paseo++. Stock Browser keeps upstream browser-data controls. The unmerged Chromium
replacement remains excluded.

The workspace Display menu stays contextual. About retains standard manual app update actions. Its Configure link appears only in Electron or
when the Android updater bridge is available, matching About. Other platforms receive information
about desktop and supported Android updates, without an unavailable action.
No duplicate controls, new stores, saved-value resets or broad preference migration were added.

## Inventory decisions

SSH host setup, advanced branch/worktree choices and Android plugin video are informational additions
without toggles, as requested. Their existing workflows and lifecycle/security fixes remain available.
Desktop background browser access, notification routing, reading continuity, mobile navigation,
workspace picker/collapse repairs and independent fork identities are always-enabled fixes or essentials.
The page includes fork repository/release links and platform limitations. It excludes the unmerged
Chromium prototype and upstream-only features.

## Browser evidence

The existing settings-navigation suite owns the two cases; no new browser test job was created.
Each run uses one worker, two CPU cores and isolated Metro/fixture-daemon homes and ports.
All owned services stopped after each run.

- Original desktop case: passed. Persisted Off values, error/retry, existing settings navigation and
  Previous agents launch-entry effects were exercised. Its pre-relocation screenshots are historical.
- Original compact attempt: failed before settings assertions because the shared tab-seeding helper
  waits for a desktop-only tab-bar button. The corrected test seeds at desktop width, then changes
  to the exact compact viewport before compact interaction/capture, matching the archive suite.
- Corrected compact case: passed in 52.9 seconds. Fresh checkpoints at 1440x900 and 390x900 verify
  every visible feature enable switch is On before any opt-out. Explorer changes persist on Paseo++
  and its controls are absent from stock Sidebar. Sticky/Previous opt-outs survive reload. A real
  browser storage failure leaves the switch unchanged with a visible retry error; retry succeeds.
  Previous agents is absent while Off and returns while On.

The final combined compact case also passed with all nine consumers present in source. The actual
page selector switch restores the legacy Workspaces heading while Off and the All Workspaces
dropdown while On. Its first sidebar captures caught the opening animation and are not qualified
visual evidence. The replacement run passed (one case, 1.2 minutes) after waiting for the existing
full-panel viewport assertion. Both replacement images were inspected fully settled: the same
project/workspace remains visible with the legacy heading Off and dropdown On. This case does not
qualify animation movement behavior.

`settings-1440-fresh-all-on.png` and `settings-390-fresh-all-on.png` are fresh defaults. The saved-Off
and re-enabled images are intentional test scenarios. They are not default settings.

These captures prove browser desktop/compact layouts, not physical Android, iOS or native Electron
behavior. Movement has separate owner evidence. Sticky overlap
and native cancellation have separate owner evidence.

## Assembled snapshot workflow

No feature branch merge or new feature commit is needed to validate the consumers. Create a unique
temporary directory, archive an exact verified base into it, then apply the shared foundation and
reviewed consumer patches in dependency order. Link root and each package's prepared `node_modules`
from this checkout. For transitions, keep a private node_modules directory rather than linking
the whole root directory. Copy the qualified patched `react-native-draggable-flatlist` dependency
from `/tmp/sidebar-transition-validation-v4/node_modules/react-native-draggable-flatlist` into
both root and app node_modules in the snapshot. Its source policy and `dragGroupKeys` API must
match the checked-in patch. Shared prepared dependencies lack these additions; do not edit them.
Do not install dependencies or use the live preview.

The final assembled `/tmp/paseo-settings-combined-validation` follows this workflow against
`c139d1d00`. All-workspace typecheck passes with the actual privately patched native dependency.
The selected combined patch applies cleanly to a fresh archive; every selected file matches the
candidate. These checks preserve the merged extension removal and current sticky source.

The current minimal foundation is `/tmp/paseo-plus-plus-foundation-v3.patch`, based on `25da9772a`.
It contains only the canonical nine enabled preferences and their existing-storage integration.
The immutable page-only snapshot patch is `/tmp/paseo-plus-plus-page-c139-v3.patch`, based on
`c139d1d00`; it excludes runtime consumers and the foundation. Consumer owners must keep these shared
files out of their own patches. Publish a new immutable page patch after locale or placement edits before reuse.

Focused existing suites, all-workspace `npm run typecheck`, `npm run lint`, targeted formatting and
`git diff --check` are the validation boundary. Do not run the full local test suite. Browser fixtures
require the coordinator's serialized slot. The transition consumer includes the source-approved v4 product delta and final v5b test-only
corrections. All fifteen distinct browser cases pass across the preserved v3 (eight), v4 (five) and
v5b (two) runs. The failed attempts and corrected test oracles remain recorded, rather than
reporting a fresh fifteen-case run. See [motion evidence](../sidebar-workspace-transitions/verification.md)
for genuine before/intermediate/after captures, off/reload/reduced motion, focus, collapse and
interruption checks. Native device/worklet runtime remains unverified.

## Focused checks

The existing storage and locale suites pass 144 cases, covering all nine enabled defaults, explicit
saved Off values, malformed/missing values, failed saves and concurrent writes. All-workspace
typecheck passes in the combined private snapshot. Lint reports zero warnings and errors.
Owner-qualified focused suites and their independent browser cases are retained; they were not
repeated. Physical native runtime remains unverified.

Copied tool logs preserve results and failure diagnostics; trailing whitespace is normalized for
patch review. Log timestamps are raw tool output.

## Independent review repairs

Both source reviewers identified missing Explorer save feedback. The repair shares save ownership
with the feature controls, including loading/read-error disabling. Platform guidance now limits
the About update action to environments with actual update controls.

The first affected compact run passed real Explorer boolean/select write failures, unchanged
durable/effective values, retry/reload and browser update guidance, then failed genuine cold-read
recovery. The trace recorded eighteen failed reads in thirty seconds and a repeating loading gate.
Canonical `retryOnMount: false` prevents child settings observers from restarting a failed hydration
when the error surface mounts. Initial query attempts are unchanged; explicit page Retry invalidates
the query. The strengthened compact rerun passed (one case, 1.4 minutes). Read attempts stop across a
1.2-second observation window while the error and all eight feature/four Explorer controls stay
mounted and disabled. Explicit Retry restores saved auto-open, diff scope and feature choices.
Both real boolean/select write failures retain durable/effective values; retry and reload persist
the intended values. Browser update information has no unavailable Configure action. The failure
and recovery captures were visually inspected. Both independent source reviewers approved the
exact repair delta, including canonical hydration retry ownership.
