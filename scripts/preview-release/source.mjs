import { execFileSync } from "node:child_process";
import { isMainModule } from "../is-main-module.mjs";

// COMPAT(forkRepositoryRename): added in v0.11.2, remove old publication identity after 2027-04-14 once cutover is complete.
const repositories = new Set(["RyanEwen/paseo", "RyanEwen/paseo-plus-plus"]);
// COMPAT(forkIntegrationRename): added in v0.11.2, remove ryan/preview after 2027-04-14 once cutover is complete.
const branches = ["ryan/preview", "main"];

/** Restrict fork release operations to the exact repository identities used during the rename. */
export function requirePreviewRepository(repository) {
  if (!repositories.has(repository)) {
    throw new Error("Preview releases require RyanEwen/paseo or RyanEwen/paseo-plus-plus");
  }
  return repository;
}

/** Accept only the old and new integration refs, never the preserved upstream mirror or a tag. */
export function requirePreviewSource({ repository, ref, commit }) {
  requirePreviewRepository(repository);
  if (!branches.some((branch) => ref === `refs/heads/${branch}`)) {
    throw new Error("Run this workflow on ryan/preview or main");
  }
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error("Preview source must be a full Git commit SHA");
  }
}

/** Require the latest push CI for this SHA to be complete and green on an integration branch. */
export function requireSuccessfulSourceCi({ commit, runs }) {
  const latest = runs.workflow_runs[0];
  if (
    !latest ||
    latest.head_sha !== commit ||
    latest.event !== "push" ||
    !branches.includes(latest.head_branch) ||
    latest.status !== "completed" ||
    latest.conclusion !== "success"
  ) {
    throw new Error("Source push CI must pass for this exact integration commit before releasing");
  }
}

if (isMainModule(import.meta.url)) {
  const repository = process.env.GITHUB_REPOSITORY;
  const commit = process.env.GITHUB_SHA;
  requirePreviewSource({ repository, ref: process.env.GITHUB_REF, commit });
  const response = execFileSync(
    "gh",
    [
      "api",
      `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${commit}&event=push&per_page=1`,
    ],
    { encoding: "utf8" },
  );
  requireSuccessfulSourceCi({ commit, runs: JSON.parse(response) });
}
