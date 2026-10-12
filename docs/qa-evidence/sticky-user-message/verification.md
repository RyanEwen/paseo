# Sticky user-message verification

Branch: `feat/sticky-user-message-navigation`. Feature implementation and QA evidence prepared for the requested commit and integration.

The sticky surface defaults to the latest user prompt. Previous and Next select and reveal
user prompts in chronological order through the existing timeline owner. Reviewing an older
prompt preserves the selection during incoming user and assistant events. Returning to the
latest prompt, sending from the composer, or using Jump to bottom resumes following new user prompts.

The collapsed preview uses two lines. Expansion uses the existing user-message renderer,
including uploaded images and file attachments, within a separately bounded scroll area.
Expansion is capped by both window height and measured available chat height, including a
short pane after keyboard resizing. The transcript viewport remains owned by its existing strategy. Compact controls use 44px
buttons; desktop controls use the shared 32px size.

## Results

| Acceptance area                                    | Evidence                                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Latest default, previous/next order and bounds     | Hook tests and real browser navigation through 20 prompts at both viewport sizes                                             |
| Unloaded older user prompts                        | Real bounded-window navigation to the oldest prompt, with the transcript row visible                                         |
| Long-prompt disclosure and complete text           | Browser expansion/collapse; collapsed height below 150px, expanded surface below 60% of viewport                             |
| Images and files                                   | Browser upload through the real composer; sticky expansion retains both attachment types and original text                   |
| Incoming user and assistant events while reviewing | Hook tests and browser selection retained during a newly submitted prompt and its response                                   |
| Empty/no-user transcript                           | Hook coverage                                                                                                                |
| Loading and failure                                | Browser held prompt-index response disables navigation; visible failure and successful Retry; hook remote-jump failure/retry |
| Tool-only/hidden older pages                       | Hook pagination follows authoritative cursor progress without requiring a visible user row                                   |
| Pagination failure without progress                | Hook coverage verifies a visible error state without repeated loading                                                        |
| Session and pane isolation                         | Independent hook instances, session/epoch component keys, scoped index and jump ownership; browser reload starts at latest   |
| Bottom anchoring                                   | Browser remains near bottom before expansion, during expansion, and after collapse                                           |
| Composer                                           | Browser unsent draft survives disclosure changes                                                                             |
| Compact and desktop layouts                        | Chromium at 390 × 844 and 1440 × 900, with reviewed screenshots                                                              |

52 focused hook/index and translation tests passed. Four isolated browser tests passed. The attachment/composer scenario also passed after
adding explicit coverage for sending while reviewing an earlier prompt.
Root typecheck and lint passed. See [unit output](tests.txt), [browser output](browser.txt),
[typecheck output](typecheck.txt), [lint output](lint.txt), and the final
[composer follow check](composer-follow.txt). Raw runner timestamps do not
specify a time zone.

The first failure-feedback browser check exposed a missing Retry translation key. The key was
corrected to the existing common action resource; the final four-test run passed.

## Commands

From the repository root:

```sh
npm run typecheck
npm run lint
```

From `packages/app`:

```sh
npx vitest run src/agent-stream/chat-outline/use-chat-outline.test.tsx src/i18n/resources.test.ts --bail=1
npm run test:e2e -- e2e/browser/chat-outline.spec.ts e2e/browser/composer-attachments.spec.ts --grep 'sticky user message'
```

Browser runs were limited to two CPUs using `os.sched_setaffinity`. Each run started its own
Metro port and disposable test daemon home; the fixtures stopped both services afterward.
Ryan's manual web service and running daemon were not controlled or restarted.

## Screenshots

- [Desktop collapsed](compact-1440.png)
- [Desktop expanded](expanded-1440.png)
- [Compact collapsed](compact-390.png)
- [Compact expanded](expanded-390.png)

## Platform limits

Android, iOS, and Electron were not executed. Compact Chromium is browser layout evidence,
not native device evidence. Native FlatList message scrolling, measured-header resizing,
software-keyboard interaction, and gestures require device verification. Provider-child
pagination and retained-pane switching were reviewed in source and covered at the selection
hook boundary, but were not exercised as complete browser or native workflows. Older-host
index-free pagination has hook coverage, without an older daemon integration run.

## Changed implementation and coverage

- `packages/app/src/agent-stream/sticky-prompt.tsx`
- `packages/app/src/agent-stream/sticky-prompt-model.ts`
- `packages/app/src/agent-stream/use-sticky-prompt.ts`
- `packages/app/src/agent-stream/chat-outline/use-chat-outline.ts`
- `packages/app/src/agent-stream/strategy-native.tsx`
- `packages/app/src/agent-stream/view.tsx`
- `packages/app/src/panels/provider-subagent-panel.tsx`
- `packages/app/src/assistant-selection-copy/surface.tsx`
- `packages/app/src/assistant-selection-copy/surface.web.tsx`
- `packages/app/src/agent-stream/chat-outline/use-chat-outline.test.tsx`
- `packages/app/e2e/browser/chat-outline.spec.ts`
- `packages/app/e2e/browser/composer-attachments.spec.ts`
- `packages/app/e2e/support/helpers/daemon-websocket-gate.ts`
- `packages/app/src/i18n/resources/en.ts`
- `packages/app/src/i18n/resources/ar.ts`
- `packages/app/src/i18n/resources/es.ts`
- `packages/app/src/i18n/resources/fr.ts`
- `packages/app/src/i18n/resources/ja.ts`
- `packages/app/src/i18n/resources/ko.ts`
- `packages/app/src/i18n/resources/pt-BR.ts`
- `packages/app/src/i18n/resources/ru.ts`
- `packages/app/src/i18n/resources/zh-CN.ts`
- `docs/timeline-sync.md`
- `README.md`

This directory contains the retained validation logs and screenshots.
