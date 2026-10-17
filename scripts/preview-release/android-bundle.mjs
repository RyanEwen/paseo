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
  prepareAndroidBundle(plan);
  compileAndroidBundle(plan);
}

/** Export fresh Metro assets and retain exact JavaScript input before a separate compiler process. */
export function prepareAndroidBundle(plan) {
  validateAndroidBundlePlan(plan);
  const { assets, resources, intermediateMaps, maps, bundle, packagerMap, compilerInput } =
    getAndroidBundlePaths(plan);
  // A repeated release attempt must not retain assets removed from the current bundle.
  rmSync(plan.preparedDir, { recursive: true, force: true });
  for (const directory of [assets, resources, intermediateMaps, maps]) {
    mkdirSync(directory, { recursive: true });
  }
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

  // The retained input survives a failed compiler attempt and is never rewritten by resume.
  copyFileSync(bundle, compilerInput);
}

/**
 * Verify the exact plan, Metro outputs, and compiler before permitting a compiler-only retry.
 * planSource is the original plan file text, including its exact serialization.
 * This function only reads inputs; a missing file or malformed/mismatched receipt aborts resume.
 * Return the verified plan parsed from those exact bytes so a caller cannot substitute another plan.
 */
export function validateAndroidBundleResume({ planSource, receipt }) {
  const plan = JSON.parse(planSource);
  validateAndroidBundlePlan(plan);
  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("Android bundle resume requires a checksum receipt");
  }
  for (const name of ["planSHA256", "metroInputSHA256", "packagerMapSHA256", "hermesSHA256"]) {
    if (typeof receipt[name] !== "string" || !/^[a-f0-9]{64}$/.test(receipt[name])) {
      throw new Error(`Android bundle resume requires a valid ${name}`);
    }
  }
  const planDigest = createHash("sha256").update(planSource).digest("hex");
  if (planDigest !== receipt.planSHA256) {
    throw new Error("Android bundle resume plan checksum mismatch");
  }

  const { bundle, compilerInput, packagerMap, hermes } = getAndroidBundlePaths(plan);
  for (const [label, file, checksum] of [
    ["Metro bundle", bundle, receipt.metroInputSHA256],
    ["retained compiler input", compilerInput, receipt.metroInputSHA256],
    ["Metro source map", packagerMap, receipt.packagerMapSHA256],
    ["Hermes compiler", hermes, receipt.hermesSHA256],
  ]) {
    const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (actual !== checksum) {
      throw new Error(`Android bundle resume ${label} checksum mismatch`);
    }
  }
  return plan;
}

/** Resume Hermes and finalization from verified Metro outputs without modifying the saved input. */
export function resumeAndroidBundle(input) {
  const plan = validateAndroidBundleResume(input);
  compileAndroidBundle(plan);
}

/** Keep normal builds and compiler-only retries on the same compiler and finalization sequence. */
function compileAndroidBundle(plan) {
  const { bundle, bytecode, compilerMap, packagerMap, finalMap, hermes } =
    getAndroidBundlePaths(plan);
  const [node, ...nodeArgs] = plan.node;
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

/** Derive the shared staging paths from the generated native task, without changing its layout. */
function getAndroidBundlePaths(plan) {
  const assets = path.join(plan.preparedDir, "assets");
  const resources = path.join(plan.preparedDir, "res");
  const intermediateMaps = path.join(plan.preparedDir, "maps");
  const maps = path.join(plan.preparedDir, "final-maps");
  const bundle = path.join(assets, plan.assetName);
  const hermes = plan.hermesCommand
    ? plan.hermesCommand.replace("%OS-BIN%", "linux64-bin")
    : path.join(plan.reactNative, "sdks/hermesc/linux64-bin/hermesc");
  return {
    assets,
    resources,
    intermediateMaps,
    maps,
    bundle,
    packagerMap: path.join(intermediateMaps, `${plan.assetName}.packager.map`),
    compilerMap: path.join(intermediateMaps, `${plan.assetName}.compiler.map`),
    finalMap: path.join(maps, `${plan.assetName}.map`),
    bytecode: `${bundle}.hbc`,
    compilerInput: path.join(plan.preparedDir, "compiler-input.js"),
    hermes,
  };
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
  const planSource = readFileSync(process.argv[2], "utf8");
  const plan = JSON.parse(planSource);
  if (process.argv[3] === undefined) {
    buildAndroidBundle(plan);
  } else if (process.argv[3] === "--metro-only" && process.argv.length === 4) {
    prepareAndroidBundle(plan);
  } else if (process.argv[3] === "--resume-from-metro" && process.argv.length === 5) {
    const receipt = JSON.parse(readFileSync(process.argv[4], "utf8"));
    resumeAndroidBundle({ planSource, receipt });
  } else {
    throw new Error(
      "Usage: android-bundle.mjs <plan> [--metro-only | --resume-from-metro <receipt>]",
    );
  }
}
