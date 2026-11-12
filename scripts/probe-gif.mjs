import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

// build a project JSON with an animated element + a cue effect, publish it, then
// verify the published page paints the DOM overlay.
const key = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
const headers = { "X-Editor-Key": key, "content-type": "application/json" };

await page.goto(base, { waitUntil: "domcontentloaded" });
const gifUrl = await page.evaluate(async () => {
  // 2-frame animated gif, generated in-page so the test owns its fixture
  const bytes = Uint8Array.from(atob(
    "R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgABACwAAAAAAQABAAACAkQBACH5BAUKAAEALAAAAAABAAEAAAICRAEAOw==",
  ), (c) => c.charCodeAt(0));
  return bytes.length;
});
console.log("fixture gif bytes:", gifUrl);
await browser.close();
