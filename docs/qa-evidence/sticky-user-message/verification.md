# Sticky user-message verification

Branch: `feat/sticky-user-message-navigation`.

The original user bubble remains in the conversation. Its compact copy appears only after
that bubble leaves the viewport. Manual scrolling selects the prompt for the response at the
reading edge; arrow navigation scrolls smoothly and retains its target through clamped landings.
The overlay follows the transcript's content rail and does not resize its viewport. Expansion
preserves full text and attachments within a height bounded by the screen and measured chat pane.

Reviewing an earlier prompt remains stable during incoming messages. Sending from the composer
or using Jump to bottom resumes the latest prompt and invalidates pending navigation, including
older window application, errors, animation frames, and native retry callbacks. Unrelated shared
reads retain their own acceptance and the timeline owner's request and epoch fences.

## Results

Eight isolated Chromium cases passed, with one worker and two CPUs. Each run used its own Metro
port and disposable fixture daemon home. The final run stopped both services afterward. No live
service was restarted or controlled. Screenshots below were reviewed at the actual test viewports.

| Acceptance area                                | Evidence                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Latest entry, previous/next order and bounds   | Browser navigation through 20 prompts at 1440 × 900 and 390 × 844; hook coverage                                                                |
| Copy appears after original leaves view        | Real wheel scrolling; original bubble visible after arrow jumps; projected Markdown source-position hook regression                             |
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
