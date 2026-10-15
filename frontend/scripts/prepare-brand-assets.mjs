// Deterministic resizing only. The approved master is never modified.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";

const directory = new URL("../public/brand/", import.meta.url);
const master = await readFile(new URL("anbit-official.png", directory));
const metadata = await sharp(master).metadata();
const raw = await sharp(master).ensureAlpha().raw().toBuffer();
const background = { r: raw[0], g: raw[1], b: raw[2], alpha: raw[3] / 255 };
const icons = [];
const faviconPngs = [];
for (const size of [16, 32, 48, 180, 192, 512]) {
  const data = await sharp(master)
    .resize(size, size, { fit: "contain", background })
    .png()
    .toBuffer();
  await writeFile(new URL(`icon-${size}.png`, directory), data);
  icons.push({ file: `icon-${size}.png`, width: size, height: size });
  if (size <= 48) faviconPngs.push({ size, data });
}
// ICO container with three lossless PNG representations.
const header = Buffer.alloc(6 + faviconPngs.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(faviconPngs.length, 4);
let offset = header.length;
faviconPngs.forEach(({ size, data }, i) => {
  const start = 6 + i * 16;
  header[start] = size;
  header[start + 1] = size;
  header.writeUInt16LE(1, start + 4);
  header.writeUInt16LE(32, start + 6);
  header.writeUInt32LE(data.length, start + 8);
  header.writeUInt32LE(offset, start + 12);
  offset += data.length;
});
await writeFile(
  new URL("../app/favicon.ico", import.meta.url),
  Buffer.concat([header, ...faviconPngs.map((p) => p.data)]),
);
await writeFile(
  new URL("brand-assets.json", directory),
  JSON.stringify(
    {
      source: "ANBIT_Official_Logo.png",
      sha256: createHash("sha256").update(master).digest("hex"),
      width: metadata.width,
      height: metadata.height,
      derivation: "contain, original background, no crop or recolour",
      icons,
    },
    null,
    2,
  ) + "\n",
);
console.log("Official logo preserved; six PNG icons and favicon prepared.");
