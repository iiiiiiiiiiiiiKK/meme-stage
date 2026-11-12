const KEY = process.env.IMG_KEY;
const base = "https://agent3.shyfai.cn";

async function probe(name, body, attempts = 1) {
  for (let i = 1; i <= attempts; i++) {
    const started = Date.now();
    try {
      const res = await fetch(`${base}/v1/images/generations`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${KEY}`,
          "content-type": "application/json",
          "idempotency-key": `p-${name}-${Date.now()}-${i}`,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      console.log(name, `#${i}`, {
        status: res.status,
        sec: Math.round((Date.now() - started) / 1000),
        ok: Boolean(parsed?.data?.[0]?.url),
        err: parsed?.error?.code,
      });
      if (parsed?.data?.[0]?.url) return parsed.data[0].url;
    } catch (error) {
      console.log(name, `#${i}`, "throw", error.message);
    }
  }
  return null;
}

const minimal = { model: "gpt-image-2.5", prompt: "a flat sticker of a blue circle", n: 1 };

console.log("--- transparency variants ---");
await probe("bg-transparent", { ...minimal, size: "1024x1024", background: "transparent" }, 2);
await probe("no-size", minimal, 1);
await probe("retry-same-key", { ...minimal, size: "1024x1024" }, 2);
