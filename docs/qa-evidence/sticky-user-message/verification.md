# Sticky user-message verification

Branch: `feat/sticky-user-message-navigation`.

The original user bubble remains in the conversation. Its compact copy fades into place while
the bubble crosses the top edge, with arrows below the copy. Newer original bubbles cover
the older copy as they approach. The more…/less… disclosure sits inside the bubble; no
user-message caption is shown. Compact previews use one line to retain the height bound
with 44px touch controls; desktop previews use two lines. Manual scrolling selects the prompt for the response at the
reading edge; arrow navigation scrolls smoothly and retains its target through clamped landings.
The overlay follows the transcript's content rail and does not resize its viewport. Expansion
preserves full text and attachments within a height bounded by the screen and measured chat pane.

Reviewing an earlier prompt remains stable during incoming messages. Sending from the composer
or using Jump to bottom resumes the latest prompt and invalidates pending navigation, including
older window application, errors, animation frames, and native retry callbacks. Unrelated shared
reads retain their own acceptance and the timeline owner's request and epoch fences.

## Results

The newest overlap/disclosure checks cover actual painted precedence through hit testing,
older/newer prompt transitions and reverse scrolling. See [desktop overlap](overlap-1440.png),
[compact overlap](overlap-390.png), [desktop run](overlap-browser-desktop.txt) and
[compact rerun](overlap-browser-compact.txt). The first compact run caught a 170px collapsed
preview, corrected to one line before its passing rerun. Earlier boot attempts failed before
behavior assertions because the unassembled checkout lacked the canonical toggle foundation
and an archive Metro fixture could not resolve outside generated-output symlinks. Those are
fixture failures, not feature results. Standalone source passes 92 unique focused cases across
hooks, controllers and locales, plus root typecheck/lint/format. Native now samples only the
leading pair so a partly visible original cannot suppress measurement of its next prompt.
No physical Android/iOS execution is claimed.

The latest two handoff/navigation Chromium cases passed at desktop and compact widths, with 51
focused hook/controller cases, root typecheck, lint and format. See [handoff browser output](handoff-browser.txt),
[focused output](handoff-tests.txt), [desktop transition](handoff-1440.png) and [compact transition](handoff-390.png).
Native history uses public window measurements with cancellation and response-order checks;
physical Android/iOS remain unexecuted.

The preceding eight isolated Chromium cases passed, with one worker and two CPUs. Each run used its own Metro
port and disposable fixture daemon home. The final run stopped both services afterward. No live
service was restarted or controlled. Screenshots below were reviewed at the actual test viewports.

| Acceptance area                                | Evidence                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Latest entry, previous/next order and bounds   | Browser navigation through 20 prompts at 1440 × 900 and 390 × 844; hook coverage                                                                |
| Copy handoff at the top edge                   | Desktop and compact wheel scrolling: original still intersects viewport with partial copy opacity; reversal hides copy; controls below bubble   |
| Manual and smooth navigation                   | Browser reading transitions; measured smooth-controller intermediate positions, settling and manual cancellation                                |
| Unloaded prompts                               | Bounded indexed navigation to oldest prompt; content-only reads preserve the active window                                                      |
| Incoming user and assistant events             | Browser retains earlier reading during a new user prompt and 85 assistant rows                                                                  |
| Long text, expansion and collapse              | Full original text, indentation, bounded height, short-pane resizing and reload                                                                 |
| Attachments and composer                       | Real image and file upload; disclosure retains both pills and text; sending while reviewing returns to latest; unsent draft survives disclosure |
| Pending navigation versus bottom/send          | Held older response released after each action; viewport remains at latest; no failure banner                                                   |
| Both window-response orders                    | Fetch-boundary cases accept only the fresh tail whether the cancelled older response settles first or last                                      |
| No-user initial pages                          | Real 85-assistant-row history, indexed and index-free loading/failure/retry; index-free discovery crosses multiple pages                        |
| Exhaustion, cancellation and bounded discovery | Hook coverage for exhaustion, failure/retry, cancellation, non-progress and explicit continuation after eight pages                             |
| Successful settled jumps                       | Original source reproduced a false error after success; corrected loaded and unloaded jumps leave error false                                   |
| Native recovery                                | Measured long live header, unmeasured header, stable target rebasing, retry/progress/time limits, obsolete callbacks and animated live landing  |
| Native reading geometry                        | FlatList viewability and measured upright live-header coordinates; original bubble visibility and visual landing offset                         |
| Empty session and pane isolation               | Hook coverage; owner-scoped reading publisher, session/epoch component identity; browser reload follows latest                                  |
| Bottom anchoring and compact controls          | Browser stays near bottom through disclosure, composer send and pane resize; shared 44px compact controls                                       |

32 prompt-state cases and 17 scrolling/controller cases passed. Supporting content-decoding,
window-acceptance, loader and locale checks passed. The declaration stack was rebuilt; root
typecheck and lint passed. Raw runner output is retained as produced; timestamps in it do not
specify a time zone.

- [Navigation and native checks](navigation-native.txt), [final prompt controls and state checks](controls.txt)
- [Content decoding checks](prompt-content.txt)
- [Window acceptance checks](window-acceptance.txt)
- [Loader and locale checks](loader-locales.txt)
- [Browser output](browser.txt)
- [Original success-error reproduction](original-success-error-repro.txt)
- [Declaration build](declarations.txt), [typecheck](typecheck.txt), [lint](lint.txt)

The fetch-boundary log is the earlier focused green run; that helper was not subsequently changed.
The final navigation log covers the expanded prompt and native cases. Early browser assertions
incorrectly required newest prompts to align at the viewport top despite bottom clamping, and
assumed an extra tail request in the held-window scenario. Those fixture assumptions were corrected.
Browser validation also exposed a missing downward-reading transition and presentation-row ID
mismatch; the implementation and independent regressions now cover both.

## Screenshots

- [Desktop compact copy](compact-1440.png), [desktop expanded](expanded-1440.png)
- [Compact copy](compact-390.png), [compact expanded](expanded-390.png)
- [Indexed discovery](discovery-indexed.png), [index-free discovery](discovery-pagination.png)

## Commands

```sh
npm run build:client
npm run typecheck
npm run lint
npm run format
# From packages/app, run only the named changed suites:
npx vitest run src/agent-stream/chat-outline/use-chat-outline.test.tsx src/agent-stream/prompt-jump-settle.test.ts --bail=1
npx vitest run src/hooks/use-load-older-agent-history.test.ts src/i18n/resources.test.ts --bail=1
npm run test:e2e -- --workers=1 --max-failures=1 e2e/browser/chat-outline.spec.ts e2e/browser/composer-attachments.spec.ts --grep sticky
```

Browser commands were launched with two-CPU affinity. No full test suite was run.

## Human preview and platform limits

The coordinator verified that installed daemon `0.11.2-preview.27` advertises
`agentTimelinePromptIndex: true` and `canonicalSubmittedPrompts: true`. Ryan's existing web
preview on port 8082 can exercise indexed jumps and content reads after the reviewed source
merge, without switching the daemon. Release remains paused for his personal test.

Physical Android, iOS, and Electron were not executed. Compact Chromium proves browser layout,
not native scrolling, gestures, software-keyboard behavior or Fabric rendering. Those need device
verification. Provider-child pagination and retained-pane switching have source and hook coverage,
but were not exercised as complete browser or native workflows. Index-free browser discovery uses
an isolated feature-gated current daemon; it does not prove integration with an actual older daemon.
Browser evidence predates the final owner-scoped reading publisher and memoized button-context
narrowing. Focused state/control tests, typecheck and lint cover those final changes. Exact-source
integration CI and the human preview test remain separate gates.
