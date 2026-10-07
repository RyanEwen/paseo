import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../is-main-module.mjs";

/** Reject a bundle plan that would replace optimized release bytecode with a development build. */
export function validateAndroidBundlePlan(plan) {
  if (plan.dev !== false || plan.hermesEnabled !== true || !plan.hermesFlags.includes("-O")) {
    throw new Error("Android previews require optimized release Hermes bytecode");
  }
  if (!plan.hermesFlags.includes("-output-source-map")) {
    throw new Error("Android previews require matching Hermes source maps");
  }
  if (plan.hermesFlags.some((flag) => flag === "-Og" || flag === "-O0")) {
    throw new Error("Android previews cannot override release Hermes optimization");
  }
}

/** Execute the generated release task's bundle phases after its configuring Gradle process exits. */
export function buildAndroidBundle(plan) {
  validateAndroidBundlePlan(plan);
  const assets = path.join(plan.preparedDir, "assets");
  const resources = path.join(plan.preparedDir, "res");
  const intermediateMaps = path.join(plan.preparedDir, "maps");
  const maps = path.join(plan.preparedDir, "final-maps");
  // A repeated release attempt must not retain assets removed from the current bundle.
  rmSync(plan.preparedDir, { recursive: true, force: true });
  for (const directory of [assets, resources, intermediateMaps, maps]) {
    mkdirSync(directory, { recursive: true });
  }
  const bundle = path.join(assets, plan.assetName);
  const packagerMap = path.join(intermediateMaps, `${plan.assetName}.packager.map`);
  const compilerMap = path.join(intermediateMaps, `${plan.assetName}.compiler.map`);
  const finalMap = path.join(maps, `${plan.assetName}.map`);
  const bytecode = `${bundle}.hbc`;
  const [node, ...nodeArgs] = plan.node;

  // Each subprocess exits before the next begins; no Java heap or Metro cache survives into Hermes.
  runPhase(
    "Metro",
    node,
    [
      ...nodeArgs,
      plan.cli,
      plan.command,
      "--platform",
      "android",
      "--dev",
      String(plan.dev),
      "--reset-cache",
      "--entry-file",
      plan.entry,
      "--bundle-output",
      bundle,
      "--assets-dest",
      resources,
      "--sourcemap-output",
      packagerMap,
      ...(plan.config ? ["--config", plan.config] : []),
      "--minify",
      String(plan.minify),
      ...plan.extraArgs,
      "--verbose",
    ],
    plan.root,
  );

  const hermes = plan.hermesCommand
    ? plan.hermesCommand.replace("%OS-BIN%", "linux64-bin")
    : path.join(plan.reactNative, "sdks/hermesc/linux64-bin/hermesc");
  // Retain the exact compiler input for replay; the final staged bundle becomes bytecode.
  copyFileSync(bundle, path.join(plan.preparedDir, "compiler-input.js"));
  console.log(
    `Hermes input: ${JSON.stringify({ source: process.env.GITHUB_SHA, bytes: readFileSync(bundle).length, sha256: createHash("sha256").update(readFileSync(bundle)).digest("hex"), plan })}`,
  );
  runPhase(
    "Hermes",
    hermes,
    [
      "-w",
      "-emit-binary",
      "-max-diagnostic-width=80",
      "-out",
      bytecode,
      bundle,
      ...plan.hermesFlags,
    ],
    plan.root,
  );
  renameSync(bytecode, bundle);
  renameSync(`${bytecode}.map`, compilerMap);

  runPhase(
    "source maps",
    node,
    [
      ...nodeArgs,
      path.join(plan.reactNative, "scripts/compose-source-maps.js"),
      packagerMap,
      compilerMap,
      "-o",
      finalMap,
    ],
    plan.root,
  );
  const bytes = readFileSync(bundle);
  if (bytes.subarray(0, 8).toString("hex") !== "c61fbc03c103191f") {
    throw new Error("Hermes did not produce bytecode");
  }
  writeFileSync(plan.digestFile, `${createHash("sha256").update(bytes).digest("hex")}\n`);
}

/** Record peak resident memory for every compiler phase so runner failures have useful evidence. */
function runPhase(name, command, args, cwd) {
  console.log(`Android preview bundle: ${name}`);
  if (name === "Hermes" && process.env.GITHUB_ACTIONS === "true") {
    execFileSync(
      "bash",
      [fileURLToPath(new URL("./android-hermes.sh", import.meta.url)), command, ...args],
      { cwd, stdio: "inherit" },
    );
    return;
  }
  execFileSync("/usr/bin/time", ["-v", command, ...args], { cwd, stdio: "inherit" });
}

if (isMainModule(import.meta.url)) {
  buildAndroidBundle(JSON.parse(readFileSync(process.argv[2], "utf8")));
}
