const { getDefaultConfig } = require("expo/metro-config");
const { resolve } = require("metro-resolver");
const path = require("path");

const projectRoot = __dirname;
const appNodeModulesRoot = path.resolve(projectRoot, "node_modules");
const appSrcRoot = path.resolve(projectRoot, "src");
const isFdroidBuild = process.env.PASEO_FDROID_BUILD === "1";
const fdroidModuleOverrides = {
  "expo-camera": path.resolve(appSrcRoot, "fdroid/expo-camera.tsx"),
  "expo-notifications": path.resolve(appSrcRoot, "fdroid/expo-notifications.ts"),
};
const customWebPlatform = (process.env.PASEO_WEB_PLATFORM ?? "")
  .trim()
  .replace(/^\./, "")
  .toLowerCase();

const config = getDefaultConfig(projectRoot);
// Prepared worktrees may reuse immutable dependency directories outside their root.
// Admit only explicitly supplied inputs; keep Metro's writable caches checkout-local.
const reusedDependencyRoots = (process.env.PASEO_METRO_REUSED_DEPENDENCY_ROOTS ?? "")
  .split(path.delimiter)
  .filter(Boolean)
  .map((directory) => path.resolve(directory));
config.watchFolders = [...new Set([...(config.watchFolders ?? []), ...reusedDependencyRoots])];
if (process.env.PASEO_METRO_CACHE_ROOT) {
  const { FileStore } = require("metro-cache");
  const cacheRoot = path.resolve(process.env.PASEO_METRO_CACHE_ROOT);
  config.cacheStores = [new FileStore({ root: path.join(cacheRoot, "transform") })];
  config.fileMapCacheDirectory = path.join(cacheRoot, "file-map");
}
if (process.env.PASEO_METRO_MAX_WORKERS) {
  const workers = Number(process.env.PASEO_METRO_MAX_WORKERS);
  if (!Number.isInteger(workers) || workers < 1) throw new Error("Invalid Metro worker count");
  config.maxWorkers = workers;
}
const defaultResolveRequest = config.resolver.resolveRequest ?? resolve;

// Keep app exports deterministic across dev machines and CI. Metro's Watchman
// crawler behavior depends on the host Watchman build/capabilities, while the
// node crawler is the path used when Watchman is absent.
config.resolver.useWatchman = false;

const escapedAppSrcRoot = appSrcRoot
  .split(path.sep)
  .map((segment) => segment.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&"))
  .join("[\\\\/]");
const pathSeparatorPattern = "[\\\\/]";

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.join(appNodeModulesRoot, "react"),
  "react-dom": path.join(appNodeModulesRoot, "react-dom"),
  "react/jsx-runtime": path.join(appNodeModulesRoot, "react/jsx-runtime"),
  "react/jsx-dev-runtime": path.join(appNodeModulesRoot, "react/jsx-dev-runtime"),
};
config.resolver.blockList = new RegExp(
  `(^${escapedAppSrcRoot}${pathSeparatorPattern}.*\\.(test|spec)\\.(ts|tsx)$|${pathSeparatorPattern}__tests__${pathSeparatorPattern}.*)$`,
);

function isLocalModuleImport(moduleName) {
  return (
    moduleName.startsWith("./") ||
    moduleName.startsWith("../") ||
    moduleName.startsWith("@/") ||
    path.isAbsolute(moduleName)
  );
}

function resolveWithCustomWebOverlay(context, moduleName, platform) {
  const shouldResolveCustomWebVariant =
    platform === "web" &&
    customWebPlatform.length > 0 &&
    customWebPlatform !== "web" &&
    isLocalModuleImport(moduleName);

  if (shouldResolveCustomWebVariant) {
    const overlayContext = {
      ...context,
      // Resolve only "<custom-platform>.<ext>" variants in overlay mode.
      sourceExts: context.sourceExts.map((ext) => `${customWebPlatform}.${ext}`),
      preferNativePlatform: false,
    };

    try {
      return defaultResolveRequest(overlayContext, moduleName, null);
    } catch {
      // Ignore overlay misses and continue with normal web resolution.
    }
  }

  return defaultResolveRequest(context, moduleName, platform);
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    reusedDependencyRoots.some((directory) =>
      context.originModulePath.startsWith(directory + path.sep),
    )
  ) {
    // Reused source is an input, not another application dependency universe.
    context = {
      ...context,
      disableHierarchicalLookup: true,
      nodeModulesPaths: [appNodeModulesRoot, path.resolve(projectRoot, "../../node_modules")],
    };
  }
  // Reused package source must share the app's React instance, even when its
  // original checkout has a different nearest node_modules directory.
  if (
    reusedDependencyRoots.length > 0 &&
    Object.hasOwn(config.resolver.extraNodeModules, moduleName)
  ) {
    return defaultResolveRequest(context, config.resolver.extraNodeModules[moduleName], platform);
  }
  if (isFdroidBuild && platform === "android" && fdroidModuleOverrides[moduleName]) {
    return resolveWithCustomWebOverlay(context, fdroidModuleOverrides[moduleName], platform);
  }

  return resolveWithCustomWebOverlay(context, moduleName, platform);
};

if (process.env.PASEO_SERVE_SIM_PREVIEW === "1") {
  const { simMiddleware } = require("serve-sim/middleware");
  const originalEnhanceMiddleware = config.server?.enhanceMiddleware;
  config.server = config.server ?? {};
  config.server.enhanceMiddleware = (metroMiddleware, server) => {
    const middleware = originalEnhanceMiddleware
      ? originalEnhanceMiddleware(metroMiddleware, server)
      : metroMiddleware;
    const serveSimulator = simMiddleware({
      basePath: "/.sim",
      device: process.env.PASEO_SERVE_SIM_DEVICE_UDID,
    });
    return (req, res, next) => {
      serveSimulator(req, res, (error) => {
        if (error) {
          if (next) {
            next(error);
            return;
          }
          throw error;
        }
        middleware(req, res, next);
      });
    };
  };
}

module.exports = config;
