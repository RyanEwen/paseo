import { z } from "zod";

const distributionMetadataSchema = z.object({
  paseoPreview: z.boolean().default(false),
});

/** Resolve packaged identity without changing the renderer's storage origin. */
export function resolveDesktopDistribution(metadata: unknown) {
  const { paseoPreview } = distributionMetadataSchema.parse(metadata);
  if (paseoPreview) {
    return {
      isPreview: true,
      appName: "Paseo++",
      // The fork uses a fresh profile independent of upstream and legacy preview installs.
      userDataName: "Paseo++",
      desktopName: "paseo-plus-plus.desktop",
      daemonHomeName: ".paseo-plus-plus-desktop",
      daemonListen: "127.0.0.1:6790",
    } as const;
  }

  return {
    isPreview: false,
    appName: "Paseo",
    userDataName: "Paseo",
    desktopName: "Paseo.desktop",
    daemonHomeName: null,
    daemonListen: null,
  } as const;
}

// The same package-relative path works in source, dist, and the packaged asar.
export const desktopDistribution = resolveDesktopDistribution(require("../package.json"));

/** Preview installs always follow the fork's custom channel, regardless of saved settings. */
export function resolveDesktopUpdateChannel(isPreview: boolean, releaseChannel: "stable" | "beta") {
  if (isPreview) {
    return { allowPrerelease: true, channel: "preview" };
  }

  return {
    allowPrerelease: releaseChannel === "beta",
    channel: releaseChannel === "beta" ? "beta" : "latest",
  };
}
