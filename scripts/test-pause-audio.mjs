import { chromium } from "@playwright/test";

// Focused probe: does 暂停/继续 suspend the clip in place, or restart it?
// Uses a published project with a real 3s WAV so the audio element exists.
const base = "https://meme-stage.pages.dev";
const key = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
const headers = { "X-Editor-Key": key, "content-type": "application/json" };

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

// track every Audio created by the engine
await page.addInitScript(() => {
  window.__audios = [];
  window.__playCalls = 0;
  const NativeAudio = window.Audio;
  window.Audio = function (...args) {
    const el = new NativeAudio(...args);
    window.__audios.push(el);
    return el;
  };
  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    window.__playCalls += 1;
    return realPlay.call(this);
  };
});

await page.goto(base, { waitUntil: "domcontentloaded" });

const voice = await page.evaluate(async ({ key }) => {
  // 3 seconds of near-silence: long enough to pause in the middle
  const rate = 8000;
  const frames = rate * 3;
  const buf = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buf);
  const tag = (o, s) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
  tag(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.sin(i / 8) * 400, true);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/wav" }), "long.wav");
  form.append("kind", "audio");
  form.append("name", "long.wav");
  form.append("duration", "3");
  const res = await fetch("/api/assets", { method: "POST", headers: { "X-Editor-Key": key }, body: form });
  return (await res.json()).asset;
}, { key });

const project = {
  version: 1,
  title: "暂停测试",
  description: "",
  mode: "preset",
  width: 1200,
  height: 800,
  background: { type: "color", color: "#0b0b12" },
  elements: [
    {
      id: "el_a",
      type: "character",
      x: 300,
      y: 200,
      width: 320,
      height: 420,
      rotation: 0,
      z: 1,
      opacity: 1,
      locked: false,
      hidden: false,
      flipX: false,
      flipY: false,
      character: {
        name: "甲",
        imageUrl: voice.url,
        voices: [{ id: "v1", name: "长句", url: voice.url, duration: 3, volume: 1, line: "这是一句很长的话" }],
        voiceMode: "cycle",
        line: "",
        bubble: {
          preset: "comic",
          bg: "#ffffff",
          fg: "#07070a",
          border: "#07070a",
          borderWidth: 4,
          fontSize: 26,
          fontFamily: "system",
          bold: true,
          italic: false,
          radius: 18,
          padding: 18,
          tail: "bottom",
          animation: "pop",
          hold: 2.6,
        },
        bubblePlacement: { anchor: "auto", offsetX: 0, offsetY: 0, maxWidth: 300 },
        effects: { outline: 0, shadow: true, glow: null, shake: false },
      },
    },
  ],
  events: [],
  performances: [
    {
      id: "pf1",
      name: "暂停测试",
      loop: false,
      cues: [{ id: "c1", actorId: "el_a", waitAfter: 0, lipFlap: true }],
    },
  ],
  settings: {
    audioMode: "single",
    reactions: true,
    showAuthor: true,
    allowRemix: true,
    authorName: "",
    soundHint: "轻点开始",
    showPlayButton: true,
  },
  updatedAt: Date.now(),
};

const created = await fetch(`${base}/api/projects`, {
  method: "POST",
  headers,
  body: JSON.stringify({ data: project }),
}).then((r) => r.json());
const published = await fetch(`${base}/api/projects/${created.id}/publish`, {
  method: "POST",
  headers,
  body: JSON.stringify({ data: project }),
}).then((r) => r.json());

await page.goto(`${base}/p/${published.slug}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="visitor"] canvas');
await page.waitForTimeout(1000);

const readAudio = () =>
  page.evaluate(() => {
    const el = window.__audios.find((a) => a && a.currentSrc);
    return el ? { paused: el.paused, t: Number(el.currentTime.toFixed(2)), plays: window.__playCalls } : null;
  });

await page.getByTestId("performance-play").click();
await page.waitForTimeout(900);
const playing = await readAudio();

await page.getByTestId("performance-play").click(); // pause
await page.waitForTimeout(200);
const paused = await readAudio();
const lipAtPause = await page.locator('[data-testid="lip-flap"]').count();
await page.waitForTimeout(900);
const stillPaused = await readAudio();

await page.getByTestId("performance-play").click(); // resume
await page.waitForTimeout(500);
const resumed = await readAudio();
const lipAfterResume = await page.locator('[data-testid="lip-flap"]').count();

console.log({ playing, paused, stillPaused, resumed });
console.log("audio actually paused:", paused?.paused === true);
console.log("position frozen while paused:", paused?.t === stillPaused?.t);
console.log("resume continued, not restarted:", (resumed?.t ?? 0) > (paused?.t ?? 0));
console.log("lip flap cleared on pause and restored:", lipAtPause === 0 && lipAfterResume > 0);
await page.waitForTimeout(3000);
const ended = await readAudio();
console.log("finished at clip end:", ended?.paused === true);
console.log("errors", errors.slice(0, 4));

await fetch(`${base}/api/projects/${created.id}`, { method: "DELETE", headers });
await fetch(`${base}/api/assets/${voice.id}`, { method: "DELETE", headers });
await browser.close();
