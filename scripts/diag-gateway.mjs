// Compare the gateway directly against what our handler sends.
const KEY = process.env.IMG_KEY;
const base = "https://agent3.shyfai.cn";

const bodies = {
  minimal: { model: "gpt-image-2.5", prompt: "a flat sticker of a red apple", n: 1, size: "1024x1024" },
  withFormat: {
    model: "gpt-image-2.5",
    prompt: "a flat sticker of a red apple",
    n: 1,
    size: "1024x1024",
    response_format: "url",
    output_format: "png",
  },
  withBackground: {
    model: "gpt-image-2.5",
    prompt: "a flat sticker of a red apple",
    n: 1,
    size: "1024x1024",
    response_format: "url",
    output_format: "png",
    background: "transparent",
  },
};

for (const [name, body] of Object.entries(bodies)) {
  const started = Date.now();
  try {
    const res = await fetch(`${base}/v1/images/generations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        "idempotency-key": `diag-${name}-${Date.now()}`,
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
    console.log(name, {
      status: res.status,
      seconds: Math.round((Date.now() - started) / 1000),
      json: Boolean(parsed),
      urls: parsed?.data?.map((d) => d.url?.slice(0, 60)),
      error: parsed?.error,
      head: parsed ? undefined : text.slice(0, 200),
    });
  } catch (error) {
    console.log(name, "threw", error.message, Math.round((Date.now() - started) / 1000));
  }
}
