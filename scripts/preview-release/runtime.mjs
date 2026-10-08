import { cpSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";

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
