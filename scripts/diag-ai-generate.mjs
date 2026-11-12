// Diagnose a failed /api/ai/generate: prints status, error code and message.
const base = "https://meme-stage.pages.dev";
const key = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

const started = Date.now();
const res = await fetch(`${base}/api/ai/generate`, {
  method: "POST",
  headers: { "content-type": "application/json", "X-Editor-Key": key },
  body: JSON.stringify({
    prompt: "a simple flat sticker of a red apple, thick white outline, transparent background, no text",
    model: "gpt-image-2.5",
    size: "1024x1024",
    background: "transparent",
  }),
});
const text = await res.text();
console.log("status:", res.status, "elapsed:", Math.round((Date.now() - started) / 1000), "s");
console.log("raw:", text.slice(0, 600));
