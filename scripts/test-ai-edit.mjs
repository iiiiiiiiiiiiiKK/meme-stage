// Verifies the style-transfer endpoint: upload reference bytes → edit → stored asset.
const base = "https://meme-stage.pages.dev";
const key = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

// Build a small PNG in Node without extra deps: reuse a canvas-free approach by
// asking the API for an existing generated asset is unreliable, so encode a tiny
// valid PNG via zlib.
import zlib from "node:zlib";

function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      raw[p++] = rgb[0];
      raw[p++] = rgb[1];
      raw[p++] = rgb[2];
    }
  }
  const crcTable = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();
  const crc32 = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const reference = png(256, 256, [220, 180, 120]);
console.log("reference bytes:", reference.length);

const form = new FormData();
form.append("file", new Blob([reference], { type: "image/png" }), "ref.png");
form.append("prompt", "turn this into a flat cartoon sticker with a thick white outline, transparent background, no text");
form.append("model", "gpt-image-2.5");
form.append("size", "1024x1024");
form.append("background", "transparent");
form.append("idempotencyKey", `edit-${Date.now()}`);
form.append("name", "AI 风格贴纸");

const started = Date.now();
const res = await fetch(`${base}/api/ai/edit`, {
  method: "POST",
  headers: { "X-Editor-Key": key },
  body: form,
});
const payload = await res.json();
console.log("edit:", res.status, `${Math.round((Date.now() - started) / 1000)}s`);
console.log({
  requestId: payload.requestId,
  asset: payload.asset && { url: payload.asset.url, mime: payload.asset.mime, size: payload.asset.size },
  error: payload.error,
});

if (payload.asset?.url) {
  const file = await fetch(`${base}${payload.asset.url}`);
  const bytes = await file.arrayBuffer();
  console.log("stored asset:", file.status, file.headers.get("content-type"), bytes.byteLength);
}

// wrong type must be rejected
const bad = new FormData();
bad.append("file", new Blob([Buffer.from("not an image")], { type: "text/plain" }), "x.txt");
bad.append("prompt", "x");
const badRes = await fetch(`${base}/api/ai/edit`, { method: "POST", headers: { "X-Editor-Key": key }, body: bad });
console.log("non-image rejected:", badRes.status, (await badRes.json()).error);
