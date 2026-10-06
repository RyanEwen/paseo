# New workspace worktree QA

Verified on October 6, 2026 with checkout source version 0.11.0-beta.5, isolated real daemons and Chromium through the existing Playwright harness. The installed client and host on port 6767 were not used or restarted. Ryan reviewed the disposable preview and requested the combined branch picker, field order, Local branch label and explicit search placeholder.

## Coverage

- Real Git workspace transport: existing-branch checkout, named branch-off from an explicit base, independent exact directory names, occupied branches, invalid names, branch/directory collisions, concurrent directory collision, external and managed checkout adoption, and missing worktree registrations. Adoption leaves `git worktree list` unchanged.
- Form model: sanitized defaults, manual name retention across mode/ref changes, capability requirements, invalid names and branch occupancy.
- Provisioning: adopting a checkout retains known fork automation restrictions, including archived records and subdirectories.
- Browser at 1440 × 1000 and 390 × 844: both creation modes, exact actual Git branch, existing checkout adoption, invalid-name and collision failures retaining edits, field order and branch-picker prefixes. Additional cases cover enumeration loading/retry, Local branch labels and repository-scoped branch choices.

## Results

Ran only focused test files/cases. No full local test suite was run.

```text
npx vitest run packages/app/src/screens/new-workspace/worktree-form-model.test.ts packages/app/src/screens/new-workspace-picker-state.test.ts --bail=1
Test Files  2 passed (2)
     Tests  24 passed (24)

# From packages/server:
npx vitest run src/server/workspace-create-worktree-source.e2e.test.ts src/server/session/workspace-provisioning/workspace-provisioning-service.test.ts --bail=1
Test Files  2 passed (2)
     Tests  52 passed (52)

# Repeated only the transport file after adding the missing-registration regression:
npx vitest run src/server/workspace-create-worktree-source.e2e.test.ts --bail=1
Test Files  1 passed (1)
     Tests  10 passed (10)

PLAYWRIGHT_BROWSERS_PATH=/tmp/paseo-worktree-playwright npm run test:e2e --workspace=@getpaseo/app -- e2e/browser/new-workspace.spec.ts --grep 'new worktree options|new worktree branch choices|Local shows'
3 passed, 2 failed (selectors also matched sidebar entries)

# After narrowing those selectors, repeated only the two affected cases:
PLAYWRIGHT_BROWSERS_PATH=/tmp/paseo-worktree-playwright npm run test:e2e --workspace=@getpaseo/app -- e2e/browser/new-workspace.spec.ts --grep 'new worktree options create.*1440|new worktree branch choices'
2 passed (1.2m)

npm run build:server
exit 0
npm run build --workspace=@getpaseo/server
exit 0
npm run typecheck
exit 0
npm run lint
Found 0 warnings and 0 errors.
npm run format
exit 0
npm run format:check
All matched files use the correct format.
git diff --check
exit 0
```

The first browser attempt timed out during cold Metro warmup before running tests. The unchanged cached retry started successfully. All five selected browser scenarios passed across the retry and the final affected-case run.

## Visual evidence

- [New branch on desktop](new-branch-desktop.png): explicit branch intent, `from` base picker and worktree name before branch name. This capture also shows the retained validation error after correcting an invalid worktree name, before resubmission.
- [Existing branch on desktop](existing-branch-desktop.png): no base picker or new-branch field.
- [Existing branch at compact width](existing-branch-compact.png).
- [Local current branch](local-desktop.png).

## Platform limits

| Surface                                       | Coverage                                         |
| --------------------------------------------- | ------------------------------------------------ |
| Browser desktop layout                        | Real Chromium and isolated source daemon         |
| Browser compact layout                        | Real Chromium at 390 px; not native verification |
| Android                                       | Not verified; no attached ADB device             |
| iOS                                           | Not verified                                     |
| Electron wrappers on Linux, Windows and macOS | Not verified                                     |

The upstream contribution is cherry-picked onto upstream `main`. All changed feature files match the locally tested commit; unrelated local modifications are excluded. Broader integration on upstream and the unverified platforms remains for CI and additional device QA.
