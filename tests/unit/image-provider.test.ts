import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALLOWED_SIZES,
  ProviderError,
  fetchGenerated,
  generateImage,
  publicCapabilities,
  readConfig,
  uploadReference,
  editImage,
} from "../../functions/_lib/imageProvider";

const CONFIG = {
  baseUrl: "https://gateway.test",
  apiKey: "sk-test",
  models: ["gpt-image-2.5"],
};

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

describe("image provider configuration", () => {
  it("reports unconfigured when either half of the credentials is missing", () => {
    expect(readConfig({})).toBeNull();
    expect(readConfig({ IMAGE_API_BASE_URL: "https://x.test" })).toBeNull();
    expect(readConfig({ IMAGE_API_KEY: "sk" })).toBeNull();
  });

  it("trims the base URL and falls back to a default model list", () => {
    const config = readConfig({ IMAGE_API_BASE_URL: "https://x.test///", IMAGE_API_KEY: " sk-1 " });
    expect(config?.baseUrl).toBe("https://x.test");
    expect(config?.apiKey).toBe("sk-1");
    expect(config?.models).toEqual(["gpt-image-2.5"]);
  });

  it("parses a comma separated model allow-list and drops blanks", () => {
    const config = readConfig({
      IMAGE_API_BASE_URL: "https://x.test",
      IMAGE_API_KEY: "sk",
      IMAGE_API_MODELS: " a , ,b ",
    });
    expect(config?.models).toEqual(["a", "b"]);
  });

  it("never leaks the key through the public capability payload", () => {
    const payload = publicCapabilities(CONFIG);
    expect(JSON.stringify(payload)).not.toContain("sk-test");
    expect(payload.configured).toBe(true);
    expect(payload.models[0].id).toBe("gpt-image-2.5");
    expect(payload.sizes).toEqual([...ALLOWED_SIZES]);
  });

  it("describes the unconfigured state instead of pretending", () => {
    const payload = publicCapabilities(null);
    expect(payload.configured).toBe(false);
    expect(payload.models).toEqual([]);
    expect(payload.reason).toContain("IMAGE_API_KEY");
  });
});

describe("image generation", () => {
  it("sends the documented body and returns the first image URL", async () => {
    const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init.body)),
        headers: new Headers(init.headers),
      });
      return jsonResponse({
        request_id: "req-1",
        size: "1024x1024",
        usage: { total_tokens: 12 },
        data: [{ url: "https://cdn.test/a.png" }],
      });
    });

    const result = await generateImage(CONFIG, { prompt: "  a cat  " }, "key-1");
    expect(result.ok).toBe(true);
    expect(result.requestId).toBe("req-1");
    expect(result.urls).toEqual(["https://cdn.test/a.png"]);
    expect(result.usage).toEqual({ total_tokens: 12 });

    const call = calls[0];
    expect(call.url).toBe("https://gateway.test/v1/images/generations");
    expect(call.headers.get("authorization")).toBe("Bearer sk-test");
    // One logical generation keeps one idempotency key, so a retry can never be
    // billed twice upstream.
    expect(call.headers.get("idempotency-key")).toBe("key-1");
    expect(call.body.prompt).toBe("a cat");
    expect(call.body.model).toBe("gpt-image-2.5");
    expect(call.body.n).toBe(1);
    expect(call.body.size).toBe("1024x1024");
    // response_format / output_format are deliberately omitted: measured against
    // the live gateway, sending them triggers a ~196s upstream timeout.
    expect(call.body.response_format).toBeUndefined();
  });

  it("rejects an empty prompt before any network call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(generateImage(CONFIG, { prompt: "   " }, "k")).rejects.toBeInstanceOf(ProviderError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a model outside the allow-list", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const error = await generateImage(CONFIG, { prompt: "x", model: "gpt-9" }, "k").catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe("model_not_allowed");
  });

  it("falls back to a known size when the request asks for a bogus one", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return jsonResponse({ data: [{ url: "https://cdn.test/a.png" }] });
    });
    await generateImage(CONFIG, { prompt: "x", size: "9999x9999" }, "k");
    expect(sent.size).toBe("1024x1024");
  });

  it("surfaces provider errors with their message", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ error: { message: "quota exceeded", code: "quota" } }, 402),
    );
    const error = await generateImage(CONFIG, { prompt: "x" }, "k").catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe("quota");
    expect(error.message).toBe("quota exceeded");
  });

  it("treats a 200 without images as a failure, never a silent success", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ data: [] }));
    const error = await generateImage(CONFIG, { prompt: "x" }, "k").catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe("provider_no_image");
  });

  it("maps a non-JSON body to a typed error", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>oops</html>", { status: 200 }));
    const error = await generateImage(CONFIG, { prompt: "x" }, "k").catch((e) => e);
    expect(error.code).toBe("provider_bad_json");
  });
});

describe("image editing", () => {
  it("requires a reference image", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const error = await editImage(CONFIG, { prompt: "x", images: [] }, "k").catch((e) => e);
    expect(error.code).toBe("missing_reference");
  });

  it("sends images[].image_url rather than a flattened file", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return jsonResponse({ data: [{ url: "https://cdn.test/b.png" }] });
    });
    await editImage(CONFIG, { prompt: "restyle", images: ["https://gateway.test/v1/images/uploads/1"] }, "k");
    expect(sent.images).toEqual([{ image_url: "https://gateway.test/v1/images/uploads/1" }]);
  });

  it("drops non-http references so a local path cannot be smuggled upstream", async () => {
    const error = await editImage(CONFIG, { prompt: "x", images: ["file:///etc/passwd"] }, "k").catch((e) => e);
    expect(error.code).toBe("missing_reference");
  });
});

describe("generation retry semantics", () => {
  it("never retries an edit with a body that lost the reference image", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      // First attempt produces no image, which used to trigger the reduced retry.
      return bodies.length === 1
        ? jsonResponse({ data: [] })
        : jsonResponse({ data: [{ url: "https://cdn.test/out.png" }] });
    });
    const error = await editImage(
      CONFIG,
      { prompt: "restyle", images: ["https://gateway.test/v1/images/uploads/1"], size: "1024x1536" },
      "edit-1",
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe("provider_no_image");
    expect(bodies).toHaveLength(1);
    expect(bodies[0].images).toEqual([{ image_url: "https://gateway.test/v1/images/uploads/1" }]);
  });

  it("retries generation once without the transparency field, keeping the same key", async () => {
    const calls: { body: Record<string, unknown>; key: string | null }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push({
        body: JSON.parse(String(init.body)),
        key: new Headers(init.headers).get("idempotency-key"),
      });
      return calls.length === 1
        ? jsonResponse({ error: { code: "upstream_total_timeout", message: "生图任务超时" } }, 400)
        : jsonResponse({ data: [{ url: "https://cdn.test/final.png" }] });
    });
    const result = await generateImage(
      CONFIG,
      { prompt: "a cat", size: "1024x1024", background: "transparent" },
      "gen-1",
    );
    expect(result.urls).toEqual(["https://cdn.test/final.png"]);
    expect(calls).toHaveLength(2);
    expect(calls[0].body.background).toBe("transparent");
    expect(calls[1].body.background).toBeUndefined();
    // Same key both times: one logical generation, one billed job.
    expect(calls[0].key).toBe("gen-1");
    expect(calls[1].key).toBe("gen-1");
  });

  it("does not retry when the caller cancelled locally", async () => {
    const calls: number[] = [];
    vi.stubGlobal("fetch", async () => {
      calls.push(1);
      const abort = new Error("aborted");
      abort.name = "AbortError";
      throw abort;
    });
    const error = await generateImage(CONFIG, { prompt: "x" }, "gen-2").catch((e) => e);
    expect(error.code).toBe("provider_timeout");
    expect(calls).toHaveLength(1);
  });
});

describe("uploaded reference", () => {
  it("posts raw bytes with the image content type", async () => {
    let observed: { url: string; type: string | null; bytes: number } | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = init.body as Uint8Array;
      observed = {
        url: String(url),
        type: new Headers(init.headers).get("content-type"),
        bytes: body.byteLength,
      };
      return jsonResponse({ url: "https://gateway.test/v1/images/uploads/9", width: 10, height: 20 });
    });
    const result = await uploadReference(CONFIG, new Uint8Array([1, 2, 3]), "image/png");
    expect(observed).toEqual({
      url: "https://gateway.test/v1/images/uploads",
      type: "image/png",
      bytes: 3,
    });
    expect(result).toEqual({ url: "https://gateway.test/v1/images/uploads/9", width: 10, height: 20 });
  });

  it("refuses a non-image content type and empty bytes", async () => {
    await expect(uploadReference(CONFIG, new Uint8Array([1]), "text/plain")).rejects.toMatchObject({
      code: "bad_reference_type",
    });
    await expect(uploadReference(CONFIG, new Uint8Array(), "image/png")).rejects.toMatchObject({
      code: "empty_reference",
    });
  });
});

describe("generated image download", () => {
  it("returns bytes and the content type", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(new Uint8Array([9, 8, 7]), {
        status: 200,
        headers: { "content-type": "image/webp" },
      }),
    );
    const result = await fetchGenerated("https://cdn.test/x.webp");
    expect(result.contentType).toBe("image/webp");
    expect(Array.from(result.bytes)).toEqual([9, 8, 7]);
  });

  it("rejects a non-http URL instead of fetching it", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const error = await fetchGenerated("file:///etc/passwd").catch((e) => e);
    expect(error.code).toBe("bad_result_url");
    expect(spy).not.toHaveBeenCalled();
  });

  it("fails loudly on an empty body", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(), { status: 200 }));
    const error = await fetchGenerated("https://cdn.test/empty.png").catch((e) => e);
    expect(error.code).toBe("result_empty");
  });
});
