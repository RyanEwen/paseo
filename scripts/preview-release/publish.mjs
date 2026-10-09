import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getGitHubRelease, getReleaseLookupTag, waitForGitHubRelease } from "../github-release.mjs";
import { uploadWithRetry } from "../upload-release-assets.mjs";
import { isMainModule } from "../is-main-module.mjs";
import { validatePreviewAssets } from "./assets.mjs";

/** Publish only a complete validated draft; never replace the bytes of a published preview. */
export async function publishPreviewRelease({ directory, repo, notes, publish }) {
  if (repo !== "RyanEwen/paseo") {
    throw new Error("Preview publishing is restricted to RyanEwen/paseo");
  }
  if (!notes?.trim()) {
    throw new Error("Provide user-facing release notes before creating a preview");
  }
  const release = JSON.parse(readFileSync(path.join(directory, "preview-release.json"), "utf8"));
  await validatePreviewAssets({ directory, release });
  const existing = getGitHubRelease(repo, release.tag);
  if (existing && (!existing.draft || existing.target_commitish !== release.commit)) {
    throw new Error("Refusing to overwrite a published preview or a draft from another commit");
  }
  const notesFile = path.join(process.env.RUNNER_TEMP, "preview-notes.md");
  const body = `${notes.trim()}

Windows (x64 and ARM64), Linux (x64 and ARM64), standalone Linux daemon/CLI packages, and Android builds are attached.
Install Paseo++ alongside the official app. Windows and Linux AppImage builds
receive future previews from this fork. Standalone hosts can install their matching daemon
package with npm and run paseo-plus-plus; host updates stay on fork previews.
Android previews check for updates in the app and install them with Android's approval.

Paseo++ has its own desktop and Android identities and starts with fresh settings.
Install it separately from the former Debug app, then set up your connections again.
Subsequent Paseo++ previews update the new installation in place.

macOS, iOS, and hosted web previews are not included.

*AI disclosure: this comment and the related code were written with the assistance of AI.*
`;
  writeFileSync(notesFile, body);

  if (!existing) {
    execFileSync(
      "gh",
      [
        "release",
        "create",
        release.tag,
        "--repo",
        repo,
        "--target",
        release.commit,
        "--title",
        `Paseo++ ${release.tag}`,
        "--draft",
        "--prerelease",
        "--notes-file",
        notesFile,
      ],
      { stdio: "inherit" },
    );
  } else {
    execFileSync(
      "gh",
      [
        "api",
        "--method",
        "PATCH",
        `repos/${repo}/releases/${existing.id}`,
        "-F",
        `body=@${notesFile}`,
      ],
      { stdio: "inherit" },
    );
  }
  const draft = await waitForGitHubRelease(repo, release.tag);
  if (!draft?.draft || draft.target_commitish !== release.commit) {
    throw new Error("Expected a draft preview before uploading assets");
  }
  const lookup = getReleaseLookupTag(draft);
  const names = readdirSync(directory).sort();
  const binaries = names.filter((name) => !name.endsWith(".yml"));
  const manifests = names.filter((name) => name.endsWith(".yml"));
  // Keep the update channel invisible until the installers and checksum file are uploaded.
  const files = [...binaries, ...manifests].map((name) => path.join(directory, name));
  const exitCode = await uploadWithRetry({ release: lookup, files, repo });
  if (exitCode !== 0) {
    throw new Error("Preview asset upload failed; the release remains a draft");
  }
  const uploaded = getGitHubRelease(repo, release.tag);
  const uploadedNames = uploaded.assets.map((asset) => asset.name).sort();
  if (JSON.stringify(uploadedNames) !== JSON.stringify(names)) {
    throw new Error(
      "Uploaded release assets do not match the validated set; the release remains a draft",
    );
  }
  if (publish) {
    execFileSync(
      "gh",
      [
        "api",
        "--method",
        "PATCH",
        `repos/${repo}/releases/${draft.id}`,
        "-F",
        "draft=false",
        "-F",
        "prerelease=true",
        "-f",
        "make_latest=false",
      ],
      { stdio: "inherit" },
    );
  }
}

if (isMainModule(import.meta.url)) {
  const [directory] = process.argv.slice(2);
  if (!directory) {
    throw new Error("Usage: node scripts/preview-release/publish.mjs <validated-release-dir>");
  }
  await publishPreviewRelease({
    directory,
    repo: process.env.GITHUB_REPOSITORY,
    notes: process.env.PASEO_PREVIEW_NOTES,
    publish: process.env.PASEO_PREVIEW_PUBLISH === "true",
  });
}
