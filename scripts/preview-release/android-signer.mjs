import { readFileSync } from "node:fs";
import { isMainModule } from "../is-main-module.mjs";

/** Require one app signer matching the preview key; distribution stamps are separate identities. */
export function verifyAndroidApkSigner(report, expectedCertificate) {
  const expected = expectedCertificate.replaceAll(":", "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error("Expected preview certificate must be a SHA-256 fingerprint");
  }

  // apksigner labels app certificates by number, SDK range, or signature scheme.
  // Anchor whole lines so a Source Stamp Signer cannot satisfy the app identity gate.
  const certificates = [
    ...report
      .replaceAll("\r\n", "\n")
      .matchAll(
        /^(?:Signer #\d+|Signer \(minSdkVersion=[^\r\n]+\)|V[1-4](?:\.\d+)? Signer:) certificate SHA-256 digest:[ \t]*([a-fA-F0-9:]+)[ \t]*$/gm,
      ),
  ];
  if (certificates.length !== 1) {
    throw new Error(`Expected exactly one APK app signer, found ${certificates.length}`);
  }
  const actual = certificates[0][1].replaceAll(":", "").toLowerCase();
  if (actual !== expected) {
    throw new Error(`APK app signer does not match the preview certificate: ${actual}`);
  }
  return actual;
}

if (isMainModule(import.meta.url)) {
  const [reportPath, expectedCertificate] = process.argv.slice(2);
  if (!reportPath || !expectedCertificate) {
    throw new Error(
      "Usage: node android-signer.mjs <apksigner-report> <expected-certificate-sha256>",
    );
  }
  const certificate = verifyAndroidApkSigner(readFileSync(reportPath, "utf8"), expectedCertificate);
  console.log(`Verified APK app signer: ${certificate}`);
}
