# Readable tool activity evidence

The feature source remains on `feat/readable-tool-activity`, based on `61ad3bc91cbc4ee263575d18ac9787aa04f72eb1`. The qualified 30-file source patch is SHA-256 `1919afcf502c06ebee92f7d6b75e528dd337f3f80e92c6ba89cc91c62245a7d2`. These evidence files were prepared afterward without changing those source bytes. [The qualified source manifest](qualified-source-manifest.json) records every file hash.

## Results and provenance

The pre-restart conversation reported 304 focused tests passing: Codex 56, Claude 21, Pi 8, OpenCode 24, presentation 15, overview projection 20, protocol display/activity 15, settings storage 105, and locale coverage 40. It also reported four desktop/compact On/Off UI cases passing. WSL restart erased their temporary raw logs. These numbers are conversation-reported results, not newly reconstructed execution evidence. The suites were not repeated.

The fresh supplemental capture scene passed in 55.0 seconds. [Its raw execution output](capture-run.txt) records one worker and four desktop/compact default-On/Off modes producing 16 durable PNGs. The scene used the existing isolated daemon harness, real Paseo routes, and canonical data produced by the shipped Codex, Claude, Pi and OpenCode mappers. It did not invoke authenticated live provider executables. [The capture producer](capture-producer.spec.ts.txt), [producer hashes](capture-producer-manifest.json), and four `*-dataset.json` files identify the exact fixture. The producer is archived as text because it is supplemental evidence, not another CI test suite.

[The route preflight](route-preflight.json) verifies actual app routes and feature markers. [The capture manifest](capture-manifest.json) records each PNG hash, viewport, URL, and full detail text. Its original absolute capture paths are provenance; the PNG paths are relative to this directory. [Teardown](teardown.json) verifies all four owned ports refused connections and no source-scoped actors remained. Timestamps quoted in raw logs are UTC; no local-time conversion was applied to those artifacts.

The first capture-only attempt timed out at the existing route settling wait before semantic capture. [Its output](capture-setup-failure.txt) is retained separately. A bounded retry restored the existing fixture origin, seed nonce and composer-ready wait and passed. The initial stall cause was not isolated. No failure image substitutes for a passing capture.

## Painted evidence

| Mode               | Labels and group              | Read command and output     | Three-file details           | Opaque command and output     |
| ------------------ | ----------------------------- | --------------------------- | ---------------------------- | ----------------------------- |
| Desktop default On | [PNG](desktop-on-labels.png)  | [PNG](desktop-on-read.png)  | [PNG](desktop-on-files.png)  | [PNG](desktop-on-opaque.png)  |
| Desktop Off        | [PNG](desktop-off-labels.png) | [PNG](desktop-off-read.png) | [PNG](desktop-off-files.png) | [PNG](desktop-off-opaque.png) |
| Compact default On | [PNG](compact-on-labels.png)  | [PNG](compact-on-read.png)  | [PNG](compact-on-files.png)  | [PNG](compact-on-opaque.png)  |
| Compact Off        | [PNG](compact-off-labels.png) | [PNG](compact-off-read.png) | [PNG](compact-off-files.png) | [PNG](compact-off-opaque.png) |

All 16 PNGs were inspected. Desktop captures show descriptive/classic labels and grouping, a distinct keyboard focus outline, statuses, exact command/output and all three file diffs. Compact Read and failed-command sheets show raw details. The compact group opens at a small height; the Off labels frame captured the entrance with only its handle visible. The long compact file output extends below the viewport, and the read output line extends horizontally. These frames do not prove offscreen pixels. The manifest preserves full exact detail text. The coordinating owner accepted these limits and declined another tail-capture fixture.

## Current preview composition

A separate 30-file increment was composed against the supplied current preview snapshot while preserving its sticky message, settings sync, editing gates and locale changes. Its SHA-256 is `dbff1dc028cf32bbf0843ca7e68b5543374faab0baa313192f0094d052dcf141`. [The increment manifest](preview-increment-manifest.json) distinguishes input, original feature and composed hashes. The isolated apply check matched all 30 resulting hashes, and a read-only apply check against the actual preview passed.

Fresh [build-client](preview-build-client.txt), [formatting](preview-format.txt), [workspace typecheck](preview-typecheck.txt), and [targeted lint](preview-lint.txt) output passed on that composed snapshot. The PNGs qualify the original feature source, not a new runtime capture of the composed preview. No semantic behavior changed during composition, so green suites were not repeated.

## Platform limits

| Platform                                     | Coverage                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Browser web on WSL Linux                     | Installed headless Chromium; 1280 by 900 desktop and 390 by 844 compact |
| iOS                                          | Not validated                                                           |
| Android                                      | Not validated                                                           |
| Packaged Electron on Linux, Windows or macOS | Not validated                                                           |
| Authenticated live provider executables      | Not invoked; mapper and protocol fixtures only                          |

No installed dependencies, live daemons, shared browser tabs or release state were changed. All feature and evidence changes remain owned by this branch until its separately granted commit slot.
