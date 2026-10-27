import fs from "node:fs";

const base = "https://meme-stage.pages.dev";
const seed = JSON.parse(fs.readFileSync(".seed/seed.json", "utf8"));
for (let i = 0; i < 5; i++) {
  const res = await fetch(`${base}/api/tts`);
  const text = await res.text();
  console.log("config", res.status, text.slice(0, 200));
  if (text.startsWith("{")) break;
  await new Promise((r) => setTimeout(r, 3000));
}

const azure = await fetch(`${base}/api/tts`, {
  method: "POST",
  headers: { "content-type": "application/json", "X-Editor-Key": seed.key },
  body: JSON.stringify({ provider: "azure", text: "测试微软语音", voice: "zh-CN-XiaoxiaoNeural" }),
});
console.log("azure", azure.status, (await azure.text()).slice(0, 300));

const melo = await fetch(`${base}/api/tts`, {
  method: "POST",
  headers: { "content-type": "application/json", "X-Editor-Key": seed.key },
  body: JSON.stringify({ provider: "melotts", text: "默认引擎仍然可用。", lang: "zh" }),
});
console.log("melotts", melo.status, (await melo.text()).slice(0, 200));
