import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../package.json", import.meta.url));
const sharp = require("sharp");
const directory = new URL("../public/brand/", import.meta.url);
test("brand master is the exact approved PNG, with original geometry", async () => {
  const data = await readFile(new URL("anbit-official.png", directory));
  assert.equal(
    createHash("sha256").update(data).digest("hex"),
    "ea6d79339af47f778d38de278fe81af8cad7052b8a6a9a87e729c854f1b0152a",
  );
  const meta = await sharp(data).metadata();
  assert.equal(meta.width, 356);
  assert.equal(meta.height, 168);
  assert.equal(meta.format, "png");
});
test("all declared platform icons exist at their advertised sizes", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../public/manifest.webmanifest", import.meta.url),
      "utf8",
    ),
  );
  for (const size of [16, 32, 48, 180, 192, 512]) {
    const metadata = await sharp(
      await readFile(new URL(`icon-${size}.png`, directory)),
    ).metadata();
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
  }
  assert.deepEqual(
    manifest.icons.map((i) => i.sizes),
    ["192x192", "512x512"],
  );
  assert.ok(manifest.icons.every((i) => i.purpose === "any")); // No maskable crop of the official wordmark.
});
test("favicon is a valid multi-size ICO with decodable lossless images", async () => {
  const ico = await readFile(new URL("../app/favicon.ico", import.meta.url));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  for (let i = 0; i < 3; i++) {
    const start = 6 + i * 16,
      size = ico[start],
      length = ico.readUInt32LE(start + 8),
      offset = ico.readUInt32LE(start + 12);
    const metadata = await sharp(
      ico.subarray(offset, offset + length),
    ).metadata();
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
  }
});
