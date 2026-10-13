import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

interface ExampleScene {
  id: string;
  directory: string;
  regions?: readonly Locator[];
  description: string;
}

/** Save genuine fixture pixels and a separate durable proof immediately, even if a later scene fails. */
export async function recordSettingsExample(page: Page, scene: ExampleScene) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("An example needs an explicit viewport");
  const manifestPath = process.env.PASEO_SETTINGS_EXAMPLE_SOURCE_MANIFEST;
  if (!manifestPath) throw new Error("Capture needs the frozen source manifest");
  const manifest = await readFile(manifestPath);
  const current = new URL(page.url());
  const ownPort = process.env.E2E_METRO_PORT;
  if (!ownPort || current.port !== ownPort)
    throw new Error("Capture must use this fixture's Metro");
  for (const region of scene.regions ?? []) await expect(region).toBeVisible();
  await mkdir(scene.directory, { recursive: true });
  const name = `${scene.id}-${Date.now()}`;
  const bytes = await page.screenshot({ animations: "disabled" });
  expect(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  const pixels = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  expect(pixels).toEqual(viewport);
  const source = `${name}.png`;
  await writeFile(join(scene.directory, source), bytes);

  const boxes = await Promise.all((scene.regions ?? []).map((region) => region.boundingBox()));
  if (boxes.some((box) => box === null)) throw new Error("Missing example bounds");
  const rectangles = boxes.filter((box) => box !== null);
  const left = rectangles.length
    ? Math.max(0, Math.floor(Math.min(...rectangles.map((box) => box.x)) - 8))
    : 0;
  const top = rectangles.length
    ? Math.max(0, Math.floor(Math.min(...rectangles.map((box) => box.y)) - 8))
    : 0;
  const right = rectangles.length
    ? Math.min(
        viewport.width,
        Math.ceil(Math.max(...rectangles.map((box) => box.x + box.width)) + 8),
      )
    : viewport.width;
  const bottom = rectangles.length
    ? Math.min(
        viewport.height,
        Math.ceil(Math.max(...rectangles.map((box) => box.y + box.height)) + 8),
      )
    : viewport.height;
  const crop = { left, top, width: right - left, height: bottom - top };
  expect(crop.width).toBeGreaterThan(0);
  expect(crop.height).toBeGreaterThan(0);
  await writeFile(
    join(scene.directory, `${name}.json`),
    JSON.stringify(
      {
        id: scene.id,
        source,
        sourceManifestSha256: createHash("sha256").update(manifest).digest("hex"),
        sourceSha256: createHash("sha256").update(bytes).digest("hex"),
        capturedAtUtc: new Date().toISOString(),
        platform: "browser web",
        viewport,
        pixels,
        crop,
        description: scene.description,
        boundary: "Illustrative still. No timing or physical native behavior is qualified.",
      },
      null,
      2,
    ) + "\n",
  );
}
