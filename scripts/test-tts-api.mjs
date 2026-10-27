import fs from "node:fs";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const seed = JSON.parse(fs.readFileSync(".seed/seed.json", "utf8"));
const results = {};

const tts = await fetch(`${base}/api/tts`, {
  method: "POST",
  headers: { "content-type": "application/json", "X-Editor-Key": seed.key },
  body: JSON.stringify({ text: "这波真的不亏，兄弟们。", lang: "zh", speed: 1.2 }),
});
const ttsBody = await tts.json();
results.status = tts.status;
results.asset = ttsBody.asset;
if (ttsBody.asset) {
  const file = await fetch(base + ttsBody.asset.url);
  const buffer = new Uint8Array(await file.arrayBuffer());
  results.file = {
    status: file.status,
    type: file.headers.get("content-type"),
    bytes: buffer.byteLength,
    header: String.fromCharCode(...buffer.subarray(0, 4)),
  };
}

const noAuth = await fetch(`${base}/api/tts`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text: "hello", lang: "en" }),
});
results.noAuth = noAuth.status;

const badLang = await fetch(`${base}/api/tts`, {
  method: "POST",
  headers: { "content-type": "application/json", "X-Editor-Key": seed.key },
  body: JSON.stringify({ text: "hello", lang: "xx" }),
});
results.badLang = badLang.status;

const tooLong = await fetch(`${base}/api/tts`, {
  method: "POST",
  headers: { "content-type": "application/json", "X-Editor-Key": seed.key },
  body: JSON.stringify({ text: "字".repeat(301), lang: "zh" }),
});
results.tooLong = tooLong.status;

console.log(JSON.stringify(results, null, 2));
