import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relative as relativePath } from "node:path";
import test from "node:test";
import { checkForkOverviewReview, getForkOverview } from "./check-fork-overview.mjs";
import { hookDecision, runHook, stateKey } from "./codex-docs-hook.mjs";
import {
  requirePreviewRepository,
  requirePreviewSource,
  requireSuccessfulSourceCi,
} from "./preview-release/source.mjs";
import {
  fingerprintBridgeAssets,
  resolvePublicationPolicy,
  updaterBridgeMarker,
} from "./preview-release/publication-policy.mjs";

const repoRoot = new URL("../", import.meta.url);
const ciWorkflowPath = new URL(".github/workflows/ci.yml", repoRoot);
const dockerWorkflowPath = new URL(".github/workflows/docker.yml", repoRoot);
const nixWorkflowPath = new URL(".github/workflows/nix.yml", repoRoot);
const filtersPath = new URL(".github/ci-paths.yml", repoRoot);
const serverTsconfigPath = new URL("packages/server/tsconfig.server.json", repoRoot);
const desktopPackagePath = new URL("packages/desktop/package.json", repoRoot);

test("Codex documentation hook supplies context and allows only one Stop continuation", () => {
  assert.match(
    hookDecision({ hook_event_name: "SessionStart" }, []).hookSpecificOutput.additionalContext,
    /README overview/,
  );
  assert.deepEqual(hookDecision({ hook_event_name: "Stop" }, []), {});
  const paths = ["packages/app/src/agent-stream/feature.ts"];
  assert.match(
    hookDecision({ hook_event_name: "PostToolUse" }, paths).hookSpecificOutput.additionalContext,
    /docs\/timeline-sync.md/,
  );
  assert.deepEqual(hookDecision({ hook_event_name: "PostToolUse" }, paths, true), {});
  assert.equal(hookDecision({ hook_event_name: "Stop" }, paths).decision, "block");
  assert.deepEqual(hookDecision({ hook_event_name: "Stop", stop_hook_active: true }, paths), {});
  assert.deepEqual(hookDecision({ hook_event_name: "Stop" }, paths, false, true), {});
  assert.notEqual(
    stateKey({ session_id: "parent", transcript_path: "child-a" }, "/repo"),
    stateKey({ session_id: "parent", transcript_path: "child-b" }, "/repo"),
  );
  assert.notEqual(
    stateKey({ session_id: "parent" }, "/worktree-a"),
    stateKey({ session_id: "parent" }, "/worktree-b"),
  );
});

test("Codex documentation hook preserves pre-existing dirty work and notices actual later edits", () => {
  const root = mkdtempSync(join(tmpdir(), "paseo-codex-docs-"));
  const code = "packages/app/src/feature.ts";
  const runGit = (args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    mkdirSync(join(root, "packages/app/src"), { recursive: true });
    mkdirSync(join(root, "empty-hooks"));
    writeFileSync(join(root, ".gitignore"), ".dev/\n");
    writeFileSync(join(root, code), "original\n");
    runGit(["init", "--quiet"]);
    runGit(["add", "."]);
    runGit([
      "-c",
      "user.name=Hook fixture",
      "-c",
      "user.email=hook@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      `core.hooksPath=${join(root, "empty-hooks")}`,
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ]);
    writeFileSync(join(root, code), "existing user work\n");
    const event = { session_id: "fixture", cwd: root, turn_id: "first" };
    runHook({ ...event, hook_event_name: "SessionStart" });
    assert.deepEqual(runHook({ ...event, hook_event_name: "Stop" }), {});
    writeFileSync(join(root, code), "agent edit\n");
    assert.match(
      runHook({ ...event, hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext,
      /feature.ts/,
    );
    assert.deepEqual(runHook({ ...event, hook_event_name: "PostToolUse" }), {});
    assert.equal(runHook({ ...event, hook_event_name: "Stop" }).decision, "block");
    assert.deepEqual(runHook({ ...event, hook_event_name: "Stop", stop_hook_active: true }), {});
    assert.deepEqual(runHook({ ...event, turn_id: "second", hook_event_name: "Stop" }), {});
    writeFileSync(join(root, "README.md"), "New user-visible feature description.\n");
    assert.equal(
      runHook({ ...event, turn_id: "second", hook_event_name: "Stop" }).decision,
      "block",
    );
    assert.match(runGit(["status", "--porcelain"]).toString(), /feature.ts/);
    assert.doesNotMatch(runGit(["status", "--porcelain"]).toString(), /codex-doc-review/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex documentation hooks are project-local and preserve the original repository check", () => {
  const hooks = JSON.parse(readFileSync(new URL(".codex/hooks.json", repoRoot), "utf8"));
  for (const event of ["SessionStart", "PostToolUse", "Stop"]) {
    const command = hooks.hooks[event][0].hooks[0];
    assert.match(command.command, /git rev-parse --show-toplevel/);
    assert.match(command.command, /scripts\/codex-docs-hook.mjs/);
    assert.match(command.commandWindows, /codex-docs-hook.mjs/);
  }
  assert.doesNotMatch(
    readFileSync(new URL("lefthook.yml", repoRoot), "utf8"),
    /fork-documentation/,
  );
  assert.match(
    readFileSync(new URL(".github/workflows/fork-overview.yml", repoRoot), "utf8"),
    /check-fork-overview.mjs/,
  );
});

test("preview releases build one checked commit and require every approved platform before publishing", () => {
  const source = readFileSync(new URL(".github/workflows/preview-release.yml", repoRoot), "utf8");
  const trigger = source.split("jobs:", 1)[0];
  assert.match(trigger, /workflow_dispatch:/);
  assert.doesNotMatch(trigger, /push:|pull_request:/);
  assert.match(source, /github\.repository == 'RyanEwen\/paseo'/);
  assert.match(source, /github\.repository == 'RyanEwen\/paseo-plus-plus'/);
  assert.match(source, /run: node scripts\/preview-release\/source\.mjs/);
  const jobs = jobBlocks(source);
  for (const job of ["desktop", "android", "release"]) {
    assert.match(jobs.get(job).join("\n"), /if: \$\{\{ !inputs\.verify_daemon_updates_only \}\}/);
  }
  const daemonJob = jobs.get("daemon").join("\n");
  assert.match(daemonJob, /daemon\.mjs --smoke/);
  assert.match(daemonJob, /if: inputs\.verify_daemon_updates_only[\s\S]*daemon-update\.mjs/);
  assert.match(source, /ref: \$\{\{ needs\.source\.outputs\.commit \}\}/);
  assert.match(source, /needs: \[source, desktop, android, daemon\]/);
  assert.match(
    source,
    /gradlew :app:assembleRelease --no-daemon --max-workers=1 -Dorg\.gradle\.parallel=false/,
  );
  assert.match(source, /writePreviewBundlePlan[\s\S]*android-bundle\.mjs[\s\S]*assembleRelease/);
  assert.match(source, /-PpaseoPreparedAndroidBundle=true/);
  assert.match(source, /unzip -p "\$apk" assets\/index\.android\.bundle \| sha256sum/);
  for (const runner of ["windows-2025", "windows-11-arm", "ubuntu-24.04", "ubuntu-24.04-arm"]) {
    assert.ok(source.includes(`runner: ${runner}`), `missing ${runner}`);
  }
  assert.doesNotMatch(source, /macos|eas build|npm publish|contents: write[\s\S]*contents: write/);
  assert.match(source, /release_kind:[\s\S]*default: bridge[\s\S]*- bridge[ \t]*\n[ \t]+- latest/);
  assert.match(
    jobs.get("source").join("\n"),
    /run: node scripts\/preview-release\/publication-policy\.mjs/,
  );
  assert.match(
    jobs.get("release").join("\n"),
    /PASEO_PREVIEW_RELEASE_KIND: \$\{\{ inputs\.release_kind \}\}/,
  );
});

/** A pinned published bridge and later source, without GitHub access or publication. */
function publicationFixture() {
  const assets = [
    {
      id: 101,
      name: "preview-release.json",
      size: 456,
      digest: `sha256:${"a".repeat(64)}`,
      state: "uploaded",
    },
    {
      id: 102,
      name: "SHA256SUMS",
      size: 789,
      digest: `sha256:${"b".repeat(64)}`,
      state: "uploaded",
    },
  ];
  const bridge = {
    id: 123,
    tag_name: "v0.11.2-preview.77",
    target_commitish: "a".repeat(40),
    draft: false,
    prerelease: true,
    body: updaterBridgeMarker,
    assets,
  };
  return {
    kind: "latest",
    release: {
      tag: "v0.11.2-preview.80",
      version: "0.11.2-preview.80",
      buildNumber: 80,
      commit: "b".repeat(40),
    },
    qualifiedBridge: {
      schemaVersion: 1,
      releaseId: bridge.id,
      tag: bridge.tag_name,
      commit: bridge.target_commitish,
      assetFingerprint: fingerprintBridgeAssets(assets),
      qualificationEvidence: "docs/qa-evidence/updater-bridge/acceptance.md",
    },
    releases: [bridge],
    comparison: {
      status: "ahead",
      base_commit: { sha: bridge.target_commitish },
      merge_base_commit: { sha: bridge.target_commitish },
    },
  };
}

test("normal Latest publication stays closed until a published bridge is qualified in reviewed source", () => {
  const fixture = publicationFixture();
  assert.throws(
    () => resolvePublicationPolicy({ ...fixture, qualifiedBridge: null }),
    /reviewed qualified-bridge receipt/,
  );
  assert.deepEqual(resolvePublicationPolicy(fixture), { prerelease: false, makeLatest: true });
  assert.deepEqual(
    resolvePublicationPolicy({ ...fixture, kind: "bridge", qualifiedBridge: null, releases: [] }),
    { prerelease: true, makeLatest: false },
  );
  assert.throws(
    () => resolvePublicationPolicy({ ...fixture, kind: "stable" }),
    /kind must be bridge or latest/,
  );
  assert.throws(
    () => resolvePublicationPolicy({ ...fixture, kind: "bridge" }),
    /final updater bridge already exists/,
  );
  assert.throws(
    () => resolvePublicationPolicy({ ...fixture, kind: "bridge", qualifiedBridge: null }),
    /final updater bridge already exists/,
  );
});

test("normal release gate requires the exact retained prerelease, asset inventory and source ancestry", () => {
  const fixture = publicationFixture();
  const bridge = fixture.releases[0];
  for (const replacement of [
    { ...bridge, draft: true },
    { ...bridge, prerelease: false },
    { ...bridge, id: bridge.id + 1 },
    { ...bridge, target_commitish: "c".repeat(40) },
    { ...bridge, body: "Unmarked old preview" },
    { ...bridge, assets: bridge.assets.slice(1) },
    { ...bridge, assets: [...bridge.assets, { ...bridge.assets[0], id: 103, name: "extra.apk" }] },
  ]) {
    assert.throws(
      () => resolvePublicationPolicy({ ...fixture, releases: [replacement] }),
      /immutable assets must remain published/,
    );
  }
  assert.throws(
    () => resolvePublicationPolicy({ ...fixture, releases: [] }),
    /immutable assets must remain published/,
  );
  for (const comparison of [
    null,
    { ...fixture.comparison, status: "identical" },
    { ...fixture.comparison, status: "diverged" },
    { ...fixture.comparison, base_commit: { sha: "c".repeat(40) } },
    { ...fixture.comparison, merge_base_commit: { sha: "c".repeat(40) } },
  ]) {
    assert.throws(
      () => resolvePublicationPolicy({ ...fixture, comparison }),
      /descend from the qualified bridge/,
    );
  }
  for (const qualificationEvidence of [
    "../receipt.md",
    "docs/qa-evidence/../receipt.md",
    "https://example.com/receipt.md",
  ]) {
    assert.throws(
      () =>
        resolvePublicationPolicy({
          ...fixture,
          qualifiedBridge: { ...fixture.qualifiedBridge, qualificationEvidence },
        }),
      /reviewed qualified-bridge receipt/,
    );
  }
});

test("normal publication preserves the native counter and desktop ordering without assuming the next run number", () => {
  const fixture = publicationFixture();
  for (const [version, buildNumber] of [
    ["0.11.2-preview.77", 77],
    ["0.11.2-preview.76", 76],
    ["0.11.1-preview.81", 81],
  ]) {
    assert.throws(
      () =>
        resolvePublicationPolicy({
          ...fixture,
          release: { ...fixture.release, tag: `v${version}`, version, buildNumber },
        }),
      /advance the published/,
    );
  }
  assert.throws(
    () =>
      resolvePublicationPolicy({
        ...fixture,
        releases: [
          ...fixture.releases,
          {
            ...fixture.releases[0],
            id: 124,
            tag_name: "v0.11.3-preview.81",
            prerelease: false,
            body: "Normal release",
          },
        ],
      }),
    /advance the published/,
  );
  assert.throws(
    () =>
      resolvePublicationPolicy({ ...fixture, release: { ...fixture.release, buildNumber: 81 } }),
    /provenance/,
  );
  assert.throws(
    () => resolvePublicationPolicy({ ...fixture, release: { ...fixture.release, tag: "v0.11.2" } }),
    /canonical fork workflow tag/,
  );
  assert.throws(
    () =>
      resolvePublicationPolicy({
        ...fixture,
        release: { ...fixture.release, tag: "v0.11.2-preview.1100000001" },
      }),
    /valid build number/,
  );
});

test("qualified bridge fingerprint detects replaced assets and ignores API inventory order", () => {
  const assets = publicationFixture().releases[0].assets;
  const fingerprint = fingerprintBridgeAssets(assets);
  assert.equal(fingerprintBridgeAssets(assets.toReversed()), fingerprint);
  for (const change of [
    { id: 999 },
    { size: 999 },
    { name: "replaced.json" },
    { digest: `sha256:${"c".repeat(64)}` },
  ]) {
    assert.notEqual(fingerprintBridgeAssets([{ ...assets[0], ...change }, assets[1]]), fingerprint);
  }
  for (const invalid of [
    [],
    [assets[0], assets[0]],
    [{ ...assets[0], state: "new" }],
    [{ ...assets[0], digest: null }],
  ]) {
    assert.throws(() => fingerprintBridgeAssets(invalid), /bridge asset/);
  }
});

test("fork code changes require a README update or an explicit review with a reason", () => {
  const readme = readFileSync(new URL("README.md", repoRoot), "utf8");
  const input = {
    before: readme,
    after: readme,
    changedFiles: ["packages/app/src/screens/workspace/workspace-screen.tsx"],
    reviewBody: "",
  };
  assert.throws(() => checkForkOverviewReview(input), /Update the opening README/);
  assert.throws(
    () => checkForkOverviewReview({ ...input, after: `${readme}\nAn unrelated upstream edit.\n` }),
    /Update the opening README/,
  );

  checkForkOverviewReview({
    ...input,
    after: readme.replace("# Paseo++", "# Paseo++\n\nA new fork feature."),
  });
  checkForkOverviewReview({
    ...input,
    reviewBody:
      "- [x] Fork overview reviewed: no change to the listed differences.\n\n" +
      "Fork overview unchanged because: This fixes a regression in the already listed sidebar controls.",
  });
  checkForkOverviewReview({ ...input, changedFiles: ["docs/release.md"] });
  checkForkOverviewReview({ ...input, before: "# Upstream README" });

  for (const reviewBody of [
    "- [ ] Fork overview reviewed: no change to the listed differences.",
    "- [x] Fork overview reviewed: no change to the listed differences.\n\n" +
      "Fork overview unchanged because: <!-- Explain why this remains accurate. -->",
    "<!-- - [x] Fork overview reviewed: no change to the listed differences. -->\n\n" +
      "Fork overview unchanged because: This fixes an existing sidebar regression.",
  ]) {
    assert.throws(
      () => checkForkOverviewReview({ ...input, reviewBody }),
      /Update the opening README/,
    );
  }
});

test("fork overview cannot disappear, move below upstream content, or gain duplicate markers", () => {
  const readme = readFileSync(new URL("README.md", repoRoot), "utf8");
  assert.match(getForkOverview(readme), /^# Paseo\+\+/);
  const historicalReadme = readme.replace("# Paseo++", "## Ryan's Paseo fork");
  assert.match(getForkOverview(historicalReadme), /^## Ryan's Paseo fork/);
  assert.equal(getForkOverview(readme.replaceAll("\n", "\r\n")), getForkOverview(readme));
  for (const invalid of [
    readme.replace("<!-- fork-overview:start -->", ""),
    readme.replace("<!-- fork-overview:end -->", ""),
    `# Upstream\n${readme}`,
    `${readme}\n<!-- fork-overview:start -->`,
    `${readme}\n<!-- fork-overview:end -->`,
    "<!-- fork-overview:start -->\n<!-- fork-overview:end -->",
  ]) {
    assert.throws(() => getForkOverview(invalid), /fork overview/);
  }
});

test("fork overview review reruns on PR edits and has no write permissions", () => {
  const source = readFileSync(new URL(".github/workflows/fork-overview.yml", repoRoot), "utf8");
  assert.match(source, /branches: \[main, ryan\/dev, ryan\/preview\]/);
  assert.match(source, /types: \[opened, synchronize, reopened, edited, ready_for_review\]/);
  assert.match(source, /github\.repository == 'RyanEwen\/paseo'/);
  assert.match(source, /github\.repository == 'RyanEwen\/paseo-plus-plus'/);
  assert.match(source, /contents: read/);
  assert.doesNotMatch(source, /pull_request_target|: write|secrets\./);
});

test("preview operations accept only exact fork repositories and integration refs during the rename", () => {
  const commit = "a".repeat(40);
  for (const repository of ["RyanEwen/paseo", "RyanEwen/paseo-plus-plus"]) {
    assert.equal(requirePreviewRepository(repository), repository);
    for (const branch of ["ryan/preview", "main"]) {
      requirePreviewSource({ repository, ref: `refs/heads/${branch}`, commit });
    }
    for (const ref of [
      "refs/heads/upstream/main",
      "refs/heads/ryan/dev",
      "refs/tags/main",
      "main",
    ]) {
      assert.throws(() => requirePreviewSource({ repository, ref, commit }), /workflow on/);
    }
    assert.throws(
      () => requirePreviewSource({ repository, ref: "refs/heads/main", commit: "short-sha" }),
      /full Git commit/,
    );
  }
  for (const repository of [
    "getpaseo/paseo",
    "other/paseo-plus-plus",
    "RyanEwen/paseo-plus-plus-extra",
    "ryanewen/paseo-plus-plus",
    "RyanEwen/paseo/",
    undefined,
  ]) {
    assert.throws(() => requirePreviewRepository(repository), /Preview releases require/);
  }
});

test("preview source CI rejects missing, mismatched, failed, or unfinished push runs", () => {
  const commit = "a".repeat(40);
  const run = {
    head_sha: commit,
    head_branch: "ryan/preview",
    event: "push",
    status: "completed",
    conclusion: "success",
  };
  requireSuccessfulSourceCi({ commit, runs: { workflow_runs: [run] } });
  requireSuccessfulSourceCi({
    commit,
    runs: { workflow_runs: [{ ...run, head_branch: "main" }] },
  });
  for (const overrides of [
    { head_sha: "b".repeat(40) },
    { head_branch: "upstream/main" },
    { event: "pull_request" },
    { status: "in_progress", conclusion: null },
    { conclusion: "failure" },
    { conclusion: "cancelled" },
    { conclusion: "skipped" },
  ]) {
    assert.throws(
      () =>
        requireSuccessfulSourceCi({ commit, runs: { workflow_runs: [{ ...run, ...overrides }] } }),
      /Source push CI must pass/,
    );
  }
  assert.throws(
    () => requireSuccessfulSourceCi({ commit, runs: { workflow_runs: [] } }),
    /Source push CI must pass/,
  );
  assert.throws(
    () =>
      requireSuccessfulSourceCi({
        commit,
        runs: { workflow_runs: [{ ...run, conclusion: "failure" }, run] },
      }),
    /Source push CI must pass/,
  );
});

test("fork main keeps upstream deployment and automatic Nix writes disabled", () => {
  const website = readFileSync(new URL(".github/workflows/deploy-website.yml", repoRoot), "utf8");
  const nix = readFileSync(new URL(".github/workflows/nix-update-hash.yml", repoRoot), "utf8");
  assert.match(website, /if: \$\{\{ github\.repository == 'getpaseo\/paseo' &&/);
  assert.match(website, /!github\.event\.release\.prerelease && !github\.event\.release\.draft/);
  assert.match(nix, /update-hash:\n    if: github\.repository == 'getpaseo\/paseo'/);
  const ci = readFileSync(ciWorkflowPath, "utf8");
  assert.equal(ci.match(/branches: \[main, ryan\/dev, ryan\/preview\]/g).length, 2);
});

const gatedCiJobs = new Map([
  ["format", { name: "format", contract: "format" }],
  ["lint", { name: "lint", contract: "quality" }],
  ["typecheck", { name: "typecheck", contract: "quality" }],
  ["server-tests-ubuntu", { name: "server-tests (ubuntu-latest)", contracts: ["server", "hub"] }],
  ["server-tests-windows", { name: "server-tests (windows-latest)", contracts: ["server", "hub"] }],
  ["server-tests-macos", { name: "server-tests (macos-14, file observation)", contract: "server" }],
  ["desktop-tests-ubuntu", { name: "desktop-tests (ubuntu-latest)", contract: "desktop" }],
  ["desktop-tests-windows", { name: "desktop-tests (windows-latest)", contract: "desktop" }],
  ["app-tests", { name: "app-tests", contract: "app" }],
  ["sdk-tests", { name: "sdk-tests", contract: "sdk" }],
  ["playwright-1", { name: "playwright (shard 1/4)", contract: "browser" }],
  ["playwright-2", { name: "playwright (shard 2/4)", contract: "browser" }],
  ["playwright-3", { name: "playwright (shard 3/4)", contract: "browser" }],
  ["playwright-4", { name: "playwright (shard 4/4)", contract: "browser" }],
  ["relay-tests", { name: "relay-tests", contract: "relay" }],
  ["cli-tests-1", { name: "cli-tests (shard 1/3)", contract: "cli" }],
  ["cli-tests-2", { name: "cli-tests (shard 2/3)", contract: "cli" }],
  ["cli-tests-3", { name: "cli-tests (shard 3/3)", contract: "cli" }],
]);

function jobBlocks(source) {
  const jobs = new Map();
  let currentJob;

  for (const line of source.split("\n")) {
    const jobMatch = /^  ([a-z0-9-]+):\s*$/.exec(line);
    if (jobMatch) {
      currentJob = jobMatch[1];
      jobs.set(currentJob, []);
      continue;
    }
    if (currentJob) jobs.get(currentJob).push(line);
  }
  return jobs;
}

function loadFilters(path) {
  const filters = {};
  let currentFilter;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const filterMatch = /^([a-z_]+):\s*$/.exec(line);
    if (filterMatch) {
      currentFilter = filterMatch[1];
      filters[currentFilter] = [];
      continue;
    }
    const patternMatch = /^  - "([^"]+)"\s*$/.exec(line);
    if (currentFilter && patternMatch) filters[currentFilter].push(patternMatch[1]);
  }
  return filters;
}

function filesUnder(relativeDirectory, predicate) {
  const directory = new URL(`${relativeDirectory}/`, repoRoot);
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      [relativeDirectory, relativePath(directory.pathname, entry.parentPath), entry.name]
        .filter(Boolean)
        .join("/")
        .replaceAll("\\", "/"),
    )
    .filter(predicate)
    .sort();
}

test("gated checks are statically named jobs with real job-level gating", () => {
  const workflowSource = readFileSync(ciWorkflowPath, "utf8");
  const jobs = jobBlocks(workflowSource);
  const trigger = workflowSource.split("jobs:", 1)[0];

  assert.match(trigger, /^\s+merge_group:\s*$/m);
  assert.doesNotMatch(workflowSource, /strategy:\s*\n\s+matrix:/);
  assert.doesNotMatch(workflowSource, /RUN_TESTS|Skip unaffected|No .* changes detected/);

  for (const [jobId, expected] of gatedCiJobs) {
    const job = jobs.get(jobId)?.join("\n");
    assert.ok(job, `missing static job ${jobId}`);
    assert.match(job, new RegExp(`^    name: ${expected.name.replace(/[()]/g, "\\$&")}$`, "m"));
    assert.match(job, /needs\.changes\.outputs\.full != 'false'/);
    for (const contract of expected.contracts ?? [expected.contract]) {
      assert.match(job, new RegExp(`needs\\.changes\\.outputs\\.${contract} != 'false'`));
    }
  }
});

test("change gating allows superseded workflow runs to cancel", () => {
  for (const workflowPath of [ciWorkflowPath, dockerWorkflowPath, nixWorkflowPath]) {
    const source = readFileSync(workflowPath, "utf8");
    assert.doesNotMatch(
      source,
      /\$\{\{\s*always\(\)/,
      "always() keeps jobs alive after concurrency cancellation; use !cancelled() for fail-open gating",
    );
  }
});

test("focused contracts stay inside existing required checks", () => {
  const jobs = jobBlocks(readFileSync(ciWorkflowPath, "utf8"));
  const changes = jobs.get("changes")?.join("\n") ?? "";
  const server = jobs.get("server-tests-ubuntu")?.join("\n") ?? "";
  const desktop = jobs.get("desktop-tests-ubuntu")?.join("\n") ?? "";

  assert.match(changes, /scripts\/daemon-launch-contract\.test\.mjs/);
  assert.doesNotMatch(changes, /Install dependencies|npm run build/);

  assert.match(server, /test:hub-cli-contract/);
  assert.match(server, /npm run test --workspace=@getpaseo\/server/);
  assert.ok(!jobs.has("hub-cli-contract"));

  assert.match(desktop, /test:e2e:renderer/);
  assert.match(desktop, /test:e2e:browser-tabs/);
  assert.match(desktop, /npm run test --workspace=@getpaseo\/desktop/);
  assert.ok(!jobs.has("desktop-browser-bridge"));
  assert.ok(!jobs.has("playwright-desktop"));
});

test("server builds exclude test utilities at every domain depth", () => {
  const tsconfig = JSON.parse(readFileSync(serverTsconfigPath, "utf8"));
  assert.ok(tsconfig.exclude.includes("src/server/**/test-utils/**"));
  assert.ok(!tsconfig.exclude.includes("src/server/test-utils/**"));
});

test("PR routing declares stable behavior ownership", () => {
  const filters = loadFilters(filtersPath);
  assert.deepEqual(filters, {
    routing: [".github/ci-paths.yml"],
    workspace: [
      ".mise.toml",
      ".tool-versions",
      "package.json",
      "package-lock.json",
      "patches/**",
      "scripts/**",
      "tsconfig.json",
      "tsconfig.base.json",
      "vitest.config.ts",
    ],
    ci: [".github/actions/**", ".github/workflows/ci.yml"],
    format: [
      ".agents/**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      ".github/**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      "**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      "packages/expo-two-way-audio/**",
    ],
    quality: ["**/*.{cjs,js,json,jsx,mjs,ts,tsx}", "packages/expo-two-way-audio/**"],
    hub: ["packages/cli/src/commands/hub/**", "packages/server/src/server/hub/**"],
    server: ["plugins/**", "packages/server/**", "packages/app/e2e/support/fixtures/recording.*"],
    desktop: [
      "packages/desktop/**",
      "packages/app/src/desktop/**",
      "packages/server/src/server/browser-tools/**",
      "packages/app/e2e/support/**",
      "packages/app/*config.{cjs,js,ts}",
      "packages/app/package.json",
    ],
    app: ["packages/app/**", "packages/expo-two-way-audio/**"],
    sdk: [
      "packages/plugin/**",
      "plugin-examples/**",
      "public-docs/plugins/**",
      "packages/client/**",
      "packages/highlight/**",
      "packages/protocol/**",
    ],
    browser: [
      "packages/server/src/server/agent/provider-snapshot-manager.ts",
      "packages/server/src/server/session/provider/provider-catalog-session.ts",
      "packages/client/src/compat/normalize-provider-models.ts",
      "packages/protocol/src/client-capabilities.ts",
      "packages/server/src/server/agent/provider-registry.ts",
      "packages/server/src/server/agent/agent-sdk-types.ts",
      "packages/server/src/server/agent/providers/codex-app-server-agent.ts",
      "packages/server/src/server/agent/providers/claude/agent.ts",
      "packages/server/src/server/agent/plugin-provider.ts",
      "packages/server/src/server/plugins/{index,plugin-process,plugin-process-protocol,runtime}.ts",
      "packages/server/src/executable-resolution/**",
      "packages/plugin/src/server/provider.ts",
      "packages/app/src/!(desktop)/**",
      "packages/app/e2e/browser/**",
      "packages/app/e2e/support/**",
      "packages/app/assets/**",
      "packages/app/public/**",
      "packages/app/index.ts",
      "packages/app/*config.{cjs,js,ts}",
      "packages/app/package.json",
    ],
    relay: ["packages/relay/**"],
    cli: ["packages/cli/**"],
  });
});

test("cross-package invariants live in the suite that owns them", () => {
  const cliTests = filesUnder("packages/cli", (path) => path.endsWith(".test.ts"));
  assert.ok(cliTests.length > 0);
  for (const path of cliTests) {
    assert.doesNotMatch(
      readFileSync(new URL(path, repoRoot), "utf8"),
      /server\/src\/server\/test-utils/,
      path,
    );
  }

  const protocolWireCompatibility = new URL(
    "packages/protocol/src/messages.wire-compat.test.ts",
    repoRoot,
  );
  assert.match(readFileSync(protocolWireCompatibility, "utf8"), /wire schema compatibility/);
});

test("browser and desktop tests have exclusive, directory-owned suites", () => {
  const filters = loadFilters(filtersPath);
  const browserSpecs = filesUnder("packages/app/e2e", (path) => path.endsWith(".spec.ts"));
  const desktopSpecs = filesUnder("packages/desktop/e2e", (path) => path.endsWith(".spec.ts"));
  const electronModules = filesUnder("packages/app/src", (path) => /\.electron\.tsx?$/.test(path));

  assert.ok(browserSpecs.length > 0);
  assert.ok(desktopSpecs.length > 0);
  assert.ok(browserSpecs.every((path) => path.startsWith("packages/app/e2e/browser/")));
  assert.ok(desktopSpecs.every((path) => path.startsWith("packages/desktop/e2e/")));
  assert.ok(electronModules.every((path) => path.startsWith("packages/app/src/desktop/")));

  const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, "utf8"));
  assert.match(desktopPackage.scripts.test, /--exclude ["']e2e\/\*\*["']/);

  for (const path of browserSpecs) {
    assert.doesNotMatch(
      readFileSync(new URL(path, repoRoot), "utf8"),
      /paseoDesktop|injectDesktopBridge/,
    );
  }
  for (const path of desktopSpecs) {
    assert.ok(path.startsWith("packages/desktop/e2e/"));
  }

  const routingSource = readFileSync(filtersPath, "utf8");
  assert.doesNotMatch(routingSource, /desktop_bridge|playwright_desktop|browser-\*|browser-\*\//);
  assert.deepEqual(filters.desktop, [
    "packages/desktop/**",
    "packages/app/src/desktop/**",
    "packages/server/src/server/browser-tools/**",
    "packages/app/e2e/support/**",
    "packages/app/*config.{cjs,js,ts}",
    "packages/app/package.json",
  ]);
  assert.deepEqual(filters.browser, [
    "packages/server/src/server/agent/provider-snapshot-manager.ts",
    "packages/server/src/server/session/provider/provider-catalog-session.ts",
    "packages/client/src/compat/normalize-provider-models.ts",
    "packages/protocol/src/client-capabilities.ts",
    "packages/server/src/server/agent/provider-registry.ts",
    "packages/server/src/server/agent/agent-sdk-types.ts",
    "packages/server/src/server/agent/providers/codex-app-server-agent.ts",
    "packages/server/src/server/agent/providers/claude/agent.ts",
    "packages/server/src/server/agent/plugin-provider.ts",
    "packages/server/src/server/plugins/{index,plugin-process,plugin-process-protocol,runtime}.ts",
    "packages/server/src/executable-resolution/**",
    "packages/plugin/src/server/provider.ts",
    "packages/app/src/!(desktop)/**",
    "packages/app/e2e/browser/**",
    "packages/app/e2e/support/**",
    "packages/app/assets/**",
    "packages/app/public/**",
    "packages/app/index.ts",
    "packages/app/*config.{cjs,js,ts}",
    "packages/app/package.json",
  ]);
});

test("packaging runs on main without allocating pull-request runners", () => {
  for (const workflowPath of [dockerWorkflowPath, nixWorkflowPath]) {
    const source = readFileSync(workflowPath, "utf8");
    const trigger = source.split("jobs:", 1)[0];
    assert.match(trigger, /push:\s*\n\s+branches: \[main\]/);
    assert.doesNotMatch(trigger, /pull_request/);
    assert.doesNotMatch(source, /dorny\/paths-filter/);
  }
});

test("desktop packaging smokes main pushes and only the pull requests that touch packaging", () => {
  const source = readFileSync(new URL(".github/workflows/desktop-packages.yml", repoRoot), "utf8");
  const trigger = source.split("jobs:", 1)[0];
  assert.match(trigger, /push:\s*\n\s+branches: \[main\]/);
  assert.match(trigger, /pull_request:\s*\n\s+branches: \[main\]\s*\n\s+paths:/);
  assert.match(trigger, /- "packages\/desktop\/\*\*"/);
  assert.doesNotMatch(source, /dorny\/paths-filter/);
  for (const action of ["actions/checkout", "actions/setup-node", "actions/upload-artifact"]) {
    assert.match(source, new RegExp(`${action}@[0-9a-f]{40} # v\\d+\\.\\d+\\.\\d+`));
  }
});
