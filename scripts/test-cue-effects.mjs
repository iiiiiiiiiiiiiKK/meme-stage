import { chromium } from "@playwright/test";

// Publishes a one-cue performance whose cue carries a GIF effect and a lip-flap,
// then verifies the sticker + mouth overlay appear when the script runs.
const base = "https://meme-stage.pages.dev";
const key = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
const headers = { "X-Editor-Key": key, "content-type": "application/json" };
const GIF_B64 =
  "R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgABACwAAAAAAQABAAACAkQBACH5BAUKAAEALAAAAAABAAEAAAICRAEAOw==";

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

await page.addInitScript(() => {
  window.__played = [];
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.currentSrc || this.src);
    setTimeout(() => this.dispatchEvent(new Event("ended")), 700);
    return Promise.resolve();
  };
});

await page.goto(base, { waitUntil: "domcontentloaded" });

const gif = await page.evaluate(
  async ({ b64, key }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "image/gif" }), "sweat.gif");
    form.append("kind", "image");
    form.append("name", "sweat.gif");
    const res = await fetch("/api/assets", {
      method: "POST",
      headers: { "X-Editor-Key": key },
      body: form,
    });
    return (await res.json()).asset;
  },
  { b64: GIF_B64, key },
);

const voice = await page.evaluate(
  async ({ key }) => {
    // 1s of silence as a real WAV so the cue has audio to wait on
    const rate = 8000;
    const frames = rate;
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
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "audio/wav" }), "line.wav");
    form.append("kind", "audio");
    form.append("name", "line.wav");
    form.append("duration", "1");
    const res = await fetch("/api/assets", {
      method: "POST",
      headers: { "X-Editor-Key": key },
      body: form,
    });
    return (await res.json()).asset;
  },
  { key },
);
console.log("assets:", gif.mime, voice.mime);

const project = {
  version: 1,
  title: "台词特效测试",
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
      y: 220,
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
        imageUrl: gif.url,
        voices: [
          { id: "v1", name: "第一句", url: voice.url, duration: 1, volume: 1, line: "我先说一句" },
        ],
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
      name: "特效测试",
      loop: false,
      cues: [
        {
          id: "c1",
          actorId: "el_a",
          waitAfter: 0,
          animation: "reaction",
          lipFlap: true,
          effects: [
            { id: "fx1", url: gif.url, kind: "gif", anchor: "top-right", size: 120, duration: 1500 },
          ],
        },
      ],
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
await page.waitForTimeout(1200);

await page.getByTestId("performance-play").click();
const seen = { effect: 0, lip: 0, bubble: 0 };
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(200);
  seen.effect = Math.max(seen.effect, await page.locator('[data-testid="cue-effect"]').count());
  seen.lip = Math.max(seen.lip, await page.locator('[data-testid="lip-flap"]').count());
  seen.bubble = Math.max(seen.bubble, await page.locator('[data-testid="bubble"]').count());
}
console.log("during cue:", seen, "played:", await page.evaluate(() => window.__played.length));
await page.waitForTimeout(1500);
console.log("after cue:", {
  effect: await page.locator('[data-testid="cue-effect"]').count(),
  lip: await page.locator('[data-testid="lip-flap"]').count(),
});
await page.screenshot({ path: "shots/cue-effects.png" });
await fetch(`${base}/api/projects/${created.id}`, { method: "DELETE", headers });
await fetch(`${base}/api/assets/${gif.id}`, { method: "DELETE", headers });
await fetch(`${base}/api/assets/${voice.id}`, { method: "DELETE", headers });
console.log("errors", errors.slice(0, 4));
await browser.close();
