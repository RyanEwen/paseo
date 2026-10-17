import type { ChangelogRelease } from "./parse-changelog";

/** Read published fork notes without interpreting Markdown headings as release boundaries. */
export function parseGitHubReleases(payload: unknown): ChangelogRelease[] {
  if (!Array.isArray(payload)) {
    throw new Error("Expected a GitHub releases list");
  }

  const published = payload.filter(isPublishedRelease);

  // GitHub orders by creation time; a previously drafted release can publish later.
  published.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));

  return published.map((entry) => ({
    version: entry.tag_name.replace(/^v(?=\d)/, ""),
    date: new Date(entry.published_at).toLocaleDateString("en-CA", {
      timeZone: "America/Toronto",
    }),
    sections: [{ title: null, body: entry.body }],
  }));
}

interface PublishedRelease {
  tag_name: string;
  body: string;
  published_at: string;
}

/** Ignore drafts, missing notes and malformed metadata returned by the remote API. */
function isPublishedRelease(entry: unknown): entry is PublishedRelease {
  if (entry === null || typeof entry !== "object") {
    return false;
  }

  const release = entry as Record<string, unknown>;
  return (
    release.draft === false &&
    typeof release.tag_name === "string" &&
    typeof release.body === "string" &&
    release.body.trim().length > 0 &&
    typeof release.published_at === "string" &&
    Number.isFinite(Date.parse(release.published_at))
  );
}
