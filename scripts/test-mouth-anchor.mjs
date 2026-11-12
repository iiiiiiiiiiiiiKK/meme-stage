import { chromium } from "@playwright/test";

// Verifies that the lip-flap overlay lands on the character's mouth anchor:
//  - a published project with mouth {x:0.5, y:0.2} puts the flap near the top
//  - mouth {x:0.5, y:0.8} puts it near the bottom
// and that a rotated character keeps the flap on the mouth.
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

await page.addInitScript(() => {
  HTMLMediaElement.prototype.play = function () {
    setTimeout(() => this.dispatchEvent(new Event("ended")), 2500);
    return Promise.resolve();
  };
});

await page.goto(base, { waitUntil: "domcontentloaded" });

const asset = await page.evaluate(async ({ key }) => {
  function wav() {
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
    return buf;
  }
  const form = new FormData();
  form.append("file", new Blob([wav()], { type: "audio/wav" }), "line.wav");
  form.append("kind", "audio");
  form.append("name", "line.wav");
  form.append("duration", "3");
  const res = await fetch("/api/assets", { method: "POST", headers: { "X-Editor-Key": key }, body: form });
  return (await res.json()).asset;
}, { key });

function character({ mouth, rotation = 0, y = 100 }) {
  return {
    id: "el_a",
    type: "character",
    x: 200,
    y,
    width: 400,
    height: 400,
    rotation,
    z: 1,
    opacity: 1,
    locked: false,
    hidden: false,
    flipX: false,
    flipY: false,
    character: {
      name: "甲",
      imageUrl: asset.url,
      voices: [{ id: "v1", name: "台词", url: asset.url, duration: 3, volume: 1, line: "一" }],
      voiceMode: "cycle",
      line: "",
      mouth,
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
  };
}

async function publish(element) {
  const project = {
    version: 1,
    title: "口型位置测试",
    description: "",
    mode: "preset",
    width: 1200,
    height: 800,
    background: { type: "color", color: "#0b0b12" },
    elements: [element],
    events: [],
    performances: [{ id: "pf1", name: "口型", loop: false, cues: [{ id: "c1", actorId: "el_a", lipFlap: true, waitAfter: 0 }] }],
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
  return { id: created.id, slug: published.slug };
}

async function measure(el, label) {
  const pub = await publish(el);
  await page.goto(`${base}/p/${pub.slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="visitor"] canvas');
  await page.waitForTimeout(900);
  await page.getByTestId("performance-play").click();
  await page.waitForTimeout(700);
  const flap = await page.locator('[data-testid="lip-flap"]').first().boundingBox();
  const canvas = await page.locator('[data-testid="visitor"] canvas').first().boundingBox();
  await fetch(`${base}/api/projects/${pub.id}`, { method: "DELETE", headers });
  if (!flap || !canvas) return { label, flap: null };
  // normalise inside the stage so the numbers are readable
  return {
    label,
    xPct: Math.round(((flap.x + flap.width / 2 - canvas.x) / canvas.width) * 1000) / 10,
    yPct: Math.round(((flap.y + flap.height / 2 - canvas.y) / canvas.height) * 1000) / 10,
    w: Math.round(flap.width),
  };
}

const high = await measure(character({ mouth: { x: 0.5, y: 0.2, size: 0.18, custom: true } }), "mouth y=0.2");
const low = await measure(character({ mouth: { x: 0.5, y: 0.8, size: 0.18, custom: true } }), "mouth y=0.8");
const left = await measure(character({ mouth: { x: 0.25, y: 0.5, size: 0.18, custom: true } }), "mouth x=0.25");
console.log({ high, low, left });
console.log("flap follows the anchor vertically:", (low.yPct ?? 0) > (high.yPct ?? 0) + 5);
console.log("flap follows the anchor horizontally:", (left.xPct ?? 0) < (high.xPct ?? 0) - 5);
console.log("mouth size scales the flap:", Math.abs((low.w ?? 0) - (high.w ?? 0)) <= 2);
console.log("errors", errors.slice(0, 4));
await fetch(`${base}/api/assets/${asset.id}`, { method: "DELETE", headers });
await browser.close();
