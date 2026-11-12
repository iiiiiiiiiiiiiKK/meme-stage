import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_BASE_URL,
  AiKeyError,
  ALLOWED_SIZES,
  KNOWN_MODELS,
  clearStoredKey,
  downloadGenerated,
  generateImage,
  probeKey,
  readStoredKey,
  restyleImage,
  saveStoredKey,
  usageSummary,
} from "../../src/features/sticker/byok";

/** Minimal localStorage so the key helpers can be tested under Node. */
function installStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("api key storage", () => {
  it("keeps a valid key and rejects an obviously truncated one", () => {
    installStorage();
    // Obviously fake value: tests must never carry a real credential.
    const fake = "sk-0123456789abcdef0123456789abcdef";
    expect(saveStoredKey(fake)).toBe(true);
    expect(readStoredKey()).toBe(fake);
    expect(saveStoredKey("sk-1")).toBe(false);
    expect(saveStoredKey("has space in it 1234")).toBe(false);
  });

  it("clears the key on request", () => {
    installStorage();
    saveStoredKey("sk-abcdefghijklmnop");
    clearStoredKey();
    expect(readStoredKey()).toBeNull();
  });
});

describe("key probing", () => {
  it("returns the models the key can reach, from the browser", async () => {
    let seen: { url: string; headers: Headers } | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen = { url: String(url), headers: new Headers(init.headers) };
      return jsonResponse({ data: [{ id: "gpt-image-2.5" }, { id: "gpt-image-2.6" }] });
    });
    const result = await probeKey("sk-test-key-123456");
    expect(result.models).toEqual(["gpt-image-2.5", "gpt-image-2.6"]);
    // Straight to the provider: no /api/ai hop, so no server key is involved.
    expect(seen!.url).toBe(`${AI_BASE_URL}/v1/models`);
    expect(seen!.headers.get("authorization")).toBe("Bearer sk-test-key-123456");
  });

  it("distinguishes a rejected key from a network failure", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    const rejected = await probeKey("sk-test-key-123456").catch((e) => e);
    expect(rejected).toBeInstanceOf(AiKeyError);
    expect(rejected.code).toBe("unauthorized");

    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const offline = await probeKey("sk-test-key-123456").catch((e) => e);
    expect(offline.code).toBe("network");
  });
});

describe("generation from the browser", () => {
  it("posts directly to the provider with the user's key", async () => {
    const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init.body)),
        auth: new Headers(init.headers).get("authorization"),
      });
      return jsonResponse({
        request_id: "req-1",
        usage: { total_tokens: 1668 },
        data: [{ url: "https://cdn.test/out.png" }],
      });
    });

    const result = await generateImage({ key: "sk-user-key-123456", prompt: " a cat " });
    expect(result.sourceUrl).toBe("https://cdn.test/out.png");
    expect(result.requestId).toBe("req-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${AI_BASE_URL}/v1/images/generations`);
    expect(calls[0].auth).toBe("Bearer sk-user-key-123456");
    expect(calls[0].body.prompt).toBe("a cat");
    expect(calls[0].body.size).toBe("1024x1024");
    // Transparency is opt-in; the default body must not carry it.
    expect(calls[0].body.background).toBeUndefined();
  });

  it("retries once without transparency, keeping the same idempotency key", async () => {
    const keys: (string | null)[] = [];
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      keys.push(new Headers(init.headers).get("idempotency-key"));
      bodies.push(JSON.parse(String(init.body)));
      return calls++ === 0
        ? jsonResponse({ error: { code: "upstream_total_timeout", message: "生图任务超时" } }, 400)
        : jsonResponse({ data: [{ url: "https://cdn.test/ok.png" }] });
    });
    let calls = 0;

    const result = await generateImage({
      key: "sk-user-key-123456",
      prompt: "a cat",
      background: "transparent",
    });
    expect(result.sourceUrl).toBe("https://cdn.test/ok.png");
    expect(bodies[0].background).toBe("transparent");
    expect(bodies[1].background).toBeUndefined();
    expect(keys[0]).toBe(keys[1]);
  });

  it("never retries a rejected key", async () => {
    const calls: number[] = [];
    vi.stubGlobal("fetch", async () => {
      calls.push(1);
      return new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 });
    });
    const error = await generateImage({
      key: "sk-bad-key-1234567",
      prompt: "x",
      background: "transparent",
    }).catch((e) => e);
    expect(error.code).toBe("provider_error");
    expect(error.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it("rejects an empty prompt before any request", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(generateImage({ key: "sk-user-key-123456", prompt: "  " })).rejects.toBeInstanceOf(AiKeyError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("falls back to a known size when asked for a bogus one", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return jsonResponse({ data: [{ url: "https://cdn.test/a.png" }] });
    });
    await generateImage({ key: "sk-user-key-123456", prompt: "x", size: "9999x9999" });
    expect(body.size).toBe("1024x1024");
  });
});

describe("restyle from the browser", () => {
  it("sends the sticker as an inline data URL, so no upload round-trip is needed", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return jsonResponse({ data: [{ url: "https://cdn.test/style.png" }] });
    });

    const file = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const result = await restyleImage({ key: "sk-user-key-123456", file, prompt: "restyle" });
    expect(result.sourceUrl).toBe("https://cdn.test/style.png");
    const images = body.images as Array<{ image_url: string }>;
    expect(images).toHaveLength(1);
    expect(images[0].image_url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("never retries a restyle: dropping the reference would return an unrelated image", async () => {
    const calls: number[] = [];
    vi.stubGlobal("fetch", async () => {
      calls.push(1);
      return jsonResponse({ data: [] });
    });
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const error = await restyleImage({ key: "sk-user-key-123456", file, prompt: "x" }).catch((e) => e);
    expect(error.code).toBe("no_image");
    expect(calls).toHaveLength(1);
  });
});

describe("result download", () => {
  it("returns the blob and refuses an oversized one", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 }));
    const blob = await downloadGenerated("https://cdn.test/x.png");
    expect(blob.size).toBe(3);

    const huge = new Uint8Array(9 * 1024 * 1024);
    vi.stubGlobal("fetch", async () => new Response(new Blob([huge]), { status: 200 }));
    const error = await downloadGenerated("https://cdn.test/big.png").catch((e) => e);
    expect(error.code).toBe("too_large");
  });

  it("reports an unreachable CDN instead of returning an empty image", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("blocked by CORS");
    });
    const error = await downloadGenerated("https://cdn.test/x.png").catch((e) => e);
    expect(error.code).toBe("network");
  });
});

describe("usage text", () => {
  it("states who pays and never invents a price", () => {
    expect(usageSummary({ total_tokens: 1668 })).toContain("1,668");
    expect(usageSummary({ total_tokens: 1668 })).toContain("你的账号");
    expect(usageSummary(null)).toBe("用量未返回");
  });

  it("exposes the verified default size and model list", () => {
    expect(ALLOWED_SIZES).toContain("1024x1024");
    expect(KNOWN_MODELS[0]).toBe("gpt-image-2.5");
  });
});
