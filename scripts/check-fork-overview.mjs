import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isMainModule } from "./is-main-module.mjs";

const startMarker = "<!-- fork-overview:start -->";
const endMarker = "<!-- fork-overview:end -->";
const reviewCheckbox = /^- \[x\] Fork overview reviewed: no change to the listed differences\.$/im;

/** Return the opening fork section, rejecting missing, duplicate, or misplaced markers. */
export function getForkOverview(readme) {
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker);
  const duplicateStart = readme.indexOf(startMarker, start + startMarker.length) !== -1;
  const duplicateEnd = readme.indexOf(endMarker, end + endMarker.length) !== -1;
  const misplaced = start < 0 || end <= start || readme.slice(0, start).trim() !== "";

  if (misplaced || duplicateStart || duplicateEnd) {
    throw new Error("README.md must start with exactly one marked fork overview section.");
  }

  const section = readme
    .slice(start + startMarker.length, end)
    .trim()
    .replaceAll("\r\n", "\n");
  // PR review reads historical base revisions that still use the original heading.
  const hasHeading = /^(?:# Paseo\+\+|## Ryan's Paseo fork)\n/.test(section);
  if (!hasHeading || section.length < 100) {
    throw new Error("The fork overview must contain its heading and a description of the fork.");
  }
  return section;
}

/** Require an overview update or a documented review for code and build changes. */
export function checkForkOverviewReview({ before, after, changedFiles, reviewBody }) {
  const section = getForkOverview(after);
  const needsReview = changedFiles.some((file) => {
    if (/\.(md|mdx)$/i.test(file)) {
      return false;
    }
    return (
      /^(packages|plugins|plugin-examples|scripts|patches)\//.test(file) ||
      file.startsWith(".github/workflows/") ||
      /^(package(-lock)?\.json|lefthook\.yml)$/.test(file)
    );
  });

  if (!needsReview) {
    return;
  }

  // The initial introduction has no marked section in the base README.
  const previousSection = before.includes(startMarker) ? getForkOverview(before) : "";
  if (section !== previousSection) {
    return;
  }

  // Strip template comments and fenced examples so untouched placeholders cannot pass.
  const body = reviewBody.replace(/<!--[\s\S]*?-->/g, "").replace(/```[\s\S]*?```/g, "");
  const reasonMatch = /^Fork overview unchanged because:[\t ]*([^\r\n]+)$/im.exec(body);
  const reason = reasonMatch?.[1]?.trim() ?? "";
  if (reviewCheckbox.test(body) && reason.length >= 10) {
    return;
  }

  throw new Error(
    "Update the opening README fork overview, or check the fork overview review box in the PR " +
      "body and explain why the listed differences remain accurate.",
  );
}

/** Read a commit's README without interpreting user-controlled revisions as Git options. */
function readCommitReadme(sha) {
  if (!/^[a-f0-9]{40,64}$/i.test(sha)) {
    throw new Error("Expected a full Git commit SHA for fork overview review.");
  }
  return execFileSync("git", ["show", `${sha}:README.md`], { encoding: "utf8" });
}

/** Validate pushes locally, or review a PR using GitHub's event data and committed trees. */
function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const event = eventPath ? JSON.parse(readFileSync(eventPath, "utf8")) : {};
  const pr = event.pull_request;

  if (!pr) {
    getForkOverview(readFileSync("README.md", "utf8"));
    console.log("Fork overview is present at the top of README.md.");
    return;
  }

  // Validate both revisions before passing them to Git. Compare the section at the merge base
  // so a stale PR cannot pass by merely differing from a newer overview on the target branch.
  readCommitReadme(pr.base.sha);
  const after = readCommitReadme(pr.head.sha);
  const mergeBase = execFileSync("git", ["merge-base", pr.base.sha, pr.head.sha], {
    encoding: "utf8",
  }).trim();
  const before = readCommitReadme(mergeBase);
  const changedFiles = execFileSync(
    "git",
    ["diff", "--name-only", "-z", `${pr.base.sha}...${pr.head.sha}`],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);

  checkForkOverviewReview({ before, after, changedFiles, reviewBody: pr.body ?? "" });
  console.log("Fork overview review passed.");
}

if (isMainModule(import.meta.url)) {
  main();
}
