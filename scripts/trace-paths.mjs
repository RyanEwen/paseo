import path from "node:path";

/** Keep nft inside the checkout, including Windows paths on a different drive or UNC share. */
export function createTraceIgnore(patterns, pathImplementation = path) {
  return (file) => {
    // nft supplies paths relative to its base. Across Windows volumes, relative()
    // returns an absolute path, which nft's default parent-directory check misses.
    if (pathImplementation.isAbsolute(file)) return true;
    const normalized = file.split(pathImplementation.sep).join("/");
    if (normalized === ".." || normalized.startsWith("../")) return true;

    return patterns.some((pattern) => path.matchesGlob(normalized, pattern));
  };
}
