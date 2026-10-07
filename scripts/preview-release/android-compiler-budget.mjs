import { isMainModule } from "../is-main-module.mjs";

const GiB = 1024 ** 3;

/** Reserve runner RAM and native-build disk before adding temporary compiler capacity. */
export function getAndroidCompilerBudget(freeDisk, availableMemory, ancestorLimits = []) {
  const swap = 16 * GiB;
  if (!Number.isFinite(freeDisk) || freeDisk < swap + 12 * GiB) {
    throw new Error(
      `Hermes requires 28 GiB free on the swap filesystem; measured ${freeDisk} bytes`,
    );
  }
  // Hosted runners should have unconstrained ancestors. A finite shared limit also
  // contains other processes, whose changing usage cannot be reserved by this driver.
  if (ancestorLimits.some((limit) => limit !== "max")) {
    throw new Error("Finite ancestor memory limits are unsupported by the hosted compiler driver");
  }
  const ram = Math.floor(Math.min(12 * GiB, availableMemory - 3 * GiB));
  if (!Number.isFinite(ram) || ram < 4 * GiB) {
    throw new Error(`Insufficient RAM to protect the runner during Hermes; budget ${ram} bytes`);
  }
  return { ram, swap };
}

if (isMainModule(import.meta.url)) {
  const { ram, swap } = getAndroidCompilerBudget(
    Number(process.argv[2]),
    Number(process.argv[3]),
    process.argv.slice(4),
  );
  console.log(`${ram} ${swap}`);
}
