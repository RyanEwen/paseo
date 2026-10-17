# Sidebar workspace transitions QA

Verified with isolated Chromium and real fixture daemons. The installed app and daemon were not controlled. Product source has two independent source approvals. Native device rendering, gesture settlement and worklet execution remain unverified because no isolated native device or emulator was available.

## Coverage

| Area                                     | Evidence                                                                                                                                                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop 1440 × 900 and compact 390 × 844 | Real 100 ms position transitions, same DOM row, keyboard focus and rename draft retained across status buckets.                                                                                                                                      |
| Painted movement                         | Before, intermediate and after screenshots for both layouts. The genuine browser animation is paused after at least 25 ms for the intermediate capture, then resumed. Frame observations confirm distinct positions.                                 |
| Nested project sorting                   | Simultaneous project and child moves count ancestor displacement once. A later child reorder after a project-only move also passes at 1280 × 720.                                                                                                    |
| Hidden panels                            | Desktop `display:none` and compact retained panel update while hidden, then reveal without replaying stale geometry.                                                                                                                                 |
| Off and reduced motion                   | Actual settings switch, reload persistence, system reduced motion and live cancellation produce instant movement.                                                                                                                                    |
| Rapid changes                            | Reversal starts from the interrupted painted position, including an unchanged layout target. A no-position-change status update has nonempty observations, stable position and no animation.                                                         |
| Hidden destinations                      | Collapse choices and the initial 20-row limit remain intact. A hidden rename draft remains owned by its open dialog. Only a disappearing row holding focus can hand it to a painted destination header.                                              |
| Clipped headers                          | Collapsed and Show more destinations with a header above the sidebar scrollport do not receive focus, even while the header remains inside browser window bounds.                                                                                    |
| Existing interactions                    | Immediate project, workspace and pinned chat mouse drags; grouping-specific sorting; saved custom order restoration.                                                                                                                                 |
| Native source policy                     | Nine tests use the actual patched dependency's completion policy. Membership/order revision changes, canceled springs and stale sessions cannot reorder an unrelated row or switch to Custom. These tests do not establish physical native behavior. |

## Results and snapshots

All 15 distinct browser cases passed across targeted runs. Failed cases were repaired and rerun; unchanged green cases were preserved.

- Revision three: 8 passed, 7 failed. Four old drag helpers expected a removed SVG scrim. Rapid interruption retained a paused offset. Collapsed-case setup tried to mark an already unread agent, and the clipped-collapse source was outside the initial row limit.
- Revision four: 5 affected cases passed, 2 failed. The interruption fix passed its first reversal. The second cancellation probe had no displacement to pause. All hidden draft and focus checks passed before a final assertion expected an ARIA attribute the existing web header does not emit.
- Final test-only revision: both remaining cases passed. Setup now establishes actual displacement before live cancellation. Collapse is checked through its saved key and absent rows. The no-motion check requires captured frames, connectivity, identity and stable position.

The final product source is revision four. Later changes only strengthen or correct the existing test fixture and oracle. The retained run logs are [revision three](browser-v3.txt), [revision four](browser-v4.txt) and [final two cases](browser-v5b.txt).

Validation assembled exact base `c139d1d00437ab83fa1c8ed7761c1b95cb1e278e`, the canonical nine-key settings foundation, the corrected current settings page and the transition consumer patch. Shared settings files are excluded from the feature patch. Existing dependencies were privately copied into each snapshot, including the actual patched draggable native dependency. No packages were installed.

- Final source/test consumer SHA256: `55b3ade6a110770af56f175561ed7100c360449232f816a636c66da7616babc7`.
- Canonical foundation SHA256: `2ad568442b4eb3d791672679c3a419969df9e68e779dc813ad00892e3c00094a`.
- Settings page SHA256: `0b32f1da948cbc89f4bc5a2a5b6b487d5c522e8744576b97740c1849da1524a9`.

Focused reorder/projection tests: 13 passed. Actual patched native completion policy: 9 passed. Final all-workspace typecheck, scoped lint and formatting checks passed. Revision three's offline Expo web export passed. No full local test suite ran.

Each browser run used one worker and two CPUs. Fixture teardown logs and direct `/proc/net/tcp` and `/proc/net/tcp6` listener audits confirmed owned Metro and daemon ports stopped before releasing the serialized slot.

## Painted captures

| Layout                   | Before                       | Intermediate                       | After                      |
| ------------------------ | ---------------------------- | ---------------------------------- | -------------------------- |
| Desktop                  | [Before](desktop-before.png) | [Intermediate](desktop-middle.png) | [After](desktop-after.png) |
| Compact                  | [Before](compact-before.png) | [Intermediate](compact-middle.png) | [After](compact-after.png) |
| Nested project and child | [Before](nested-before.png)  | [Intermediate](nested-middle.png)  | [After](nested-after.png)  |

Reveal captures: [desktop](desktop-hidden-reveal.png), [compact](compact-hidden-reveal.png).

Clipped destination captures: [collapsed](collapsed-header-clipped.png), [20-row limit](limit-header-clipped.png).
