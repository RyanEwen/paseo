import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

/** Retain each shipped package's existing notices, including explicit vendored notice files. */
function stagePackageNotices({ root, output, files }) {
  const noticeName = /^(licen[cs]es?|notice|copying|copyright)(?:[._-].*)?$/i;
  const manifests = files.filter((file) => path.basename(file) === "package.json");
  for (const file of manifests) {
    const packageDirectory = path.dirname(file);
    const sourceDirectory = path.join(root, packageDirectory);
    const manifest = JSON.parse(readFileSync(path.join(root, file), "utf8"));
    const notices = readdirSync(sourceDirectory).filter((name) => noticeName.test(name));
    // npm retains notice files listed under files as well as conventional root notices.
    for (const entry of manifest.files ?? []) {
      if (typeof entry !== "string" || !noticeName.test(path.basename(entry))) continue;
      if (entry.includes("*") || entry.startsWith("!") || path.isAbsolute(entry)) continue;
      const relative = path.relative(sourceDirectory, path.resolve(sourceDirectory, entry));
      if (relative.startsWith(`..${path.sep}`) || relative === "..") continue;
      if (existsSync(path.join(sourceDirectory, entry))) notices.push(entry);
    }
    for (const notice of new Set(notices)) {
      const target = path.join(output, packageDirectory, notice);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(sourceDirectory, notice), target, { recursive: true, dereference: true });
    }
  }
}

/** Materialize only traced files, then replace workspace links with their staged runtime contents. */
export function stageDaemonRuntime({ root, output, files }) {
  const directoryLinks = [];

  for (const file of files) {
    const source = path.join(root, file);
    const target = path.join(output, file);
    const metadata = lstatSync(source);
    if (metadata.isSymbolicLink()) {
      const relativeTarget = path.relative(root, realpathSync(source));
      if (relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
        throw new Error(`Runtime link escapes the checkout: ${file}`);
      }
      const resolvedMetadata = lstatSync(realpathSync(source));
      if (resolvedMetadata.isDirectory()) {
        directoryLinks.push({ target, stagedSource: path.join(output, relativeTarget) });
        continue;
      }
    } else if (metadata.isDirectory()) {
      mkdirSync(target, { recursive: true });
      continue;
    }

    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target, { dereference: true });
  }

  stagePackageNotices({ root, output, files });

  // fs-loaded browser assets are owned by the web build, rather than the Node module trace.
  const webUi = "packages/server/dist/server/web-ui";
  cpSync(path.join(root, webUi), path.join(output, webUi), { recursive: true });

  // Copy from the staged tree: copying from the checkout here would admit source files,
  // ignored credentials, and development dependencies that the trace never selected.
  for (const link of directoryLinks) {
    mkdirSync(path.dirname(link.target), { recursive: true });
    cpSync(link.stagedSource, link.target, { recursive: true });
  }
}
