import { afterEach, describe, expect, it, vi } from "vitest";
import { externalKey, externalUrlOf, readImageHost, uploadToImgbb, ImageHostError } from "../../functions/_lib/imageHost";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("image host selection", () => {
  it("defaults to R2 so existing behaviour is unchanged", () => {
    expect(readImageHost({})).toEqual({ kind: "r2" });
    expect(readImageHost({ IMAGE_HOST: "r2" })).toEqual({ kind: "r2" });
  });

  it("only switches to imgbb when a key is actually present", () => {
    expect(readImageHost({ IMAGE_HOST: "imgbb" })).toEqual({ kind: "r2" });
    expect(readImageHost({ IMAGE_HOST: "imgbb", IMGBB_API_KEY: " k " })).toEqual({
      kind: "imgbb",
      apiKey: "k",
    });
  });

  it("round-trips an external key without accepting a non-https URL", () => {
    const key = externalKey("https://i.ibb.co/x/y.png");
    expect(key.startsWith("ext::")).toBe(true);
    expect(externalUrlOf(key)).toBe("https://i.ibb.co/x/y.png");
    expect(externalUrlOf(externalKey("http://insecure.test/a.png"))).toBeNull();
    expect(externalUrlOf("meme-stage/image/a.png")).toBeNull();
  });
});

describe("imgbb upload", () => {
  it("posts a urlencoded body and returns the direct image url", async () => {
    let seen: { url: string; contentType: string | null; body: string } | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      // The adapter uploads, then asks the hosted URL for its real byte size.
      if (init.method === "HEAD") {
        return new Response(null, { status: 200, headers: { "content-length": "4242" } });
      }
      seen = {
        url: String(url),
        contentType: new Headers(init.headers).get("content-type"),
        body: String(init.body),
      };
      return new Response(
        JSON.stringify({
          success: true,
          status: 200,
          data: { display_url: "https://i.ibb.co/w04/x.png", width: "4", height: "4" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await uploadToImgbb({ apiKey: "secret" }, PNG, "贴纸");
    // The size comes from the hosted file, not from imgbb's own claim.
    expect(result).toEqual({ url: "https://i.ibb.co/w04/x.png", width: 4, height: 4, size: 4242 });
    expect(seen!.url).toBe("https://api.imgbb.com/1/upload?key=secret");
    expect(seen!.contentType).toBe("application/x-www-form-urlencoded");
    expect(seen!.body).toContain("image=");
    expect(seen!.body).not.toContain("secret");
  });

  it("still succeeds when the size probe fails", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      if (init.method === "HEAD") throw new Error("head blocked");
      return new Response(
        JSON.stringify({ success: true, data: { display_url: "https://i.ibb.co/a/b.png", size: "999" } }),
        { status: 200 },
      );
    });
    const result = await uploadToImgbb({ apiKey: "k" }, PNG, "x");
    expect(result.url).toBe("https://i.ibb.co/a/b.png");
    expect(result.size).toBe(999);
  });

  it("falls back to data.url when display_url is absent", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ success: true, data: { url: "https://i.ibb.co/a/b.png" } }), {
          status: 200,
        }),
    );
    const result = await uploadToImgbb({ apiKey: "k" }, PNG, "x");
    expect(result.url).toBe("https://i.ibb.co/a/b.png");
    expect(result.width).toBeNull();
  });

  it("surfaces a provider rejection with its own message", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ success: false, error: { message: "Invalid API v1 key." } }), {
          status: 400,
        }),
    );
    const error = await uploadToImgbb({ apiKey: "bad" }, PNG, "x").catch((e) => e);
    expect(error).toBeInstanceOf(ImageHostError);
    expect(error.message).toBe("Invalid API v1 key.");
    expect(error.code).toBe("host_failed");
  });

  it("refuses an empty payload before any network call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const error = await uploadToImgbb({ apiKey: "k" }, new Uint8Array(), "x").catch((e) => e);
    expect(error.code).toBe("host_empty");
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON or non-https response instead of storing garbage", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 200 }));
    const bad = await uploadToImgbb({ apiKey: "k" }, PNG, "x").catch((e) => e);
    expect(bad.code).toBe("host_bad_json");

    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ success: true, data: { url: "ftp://x/y.png" } }), { status: 200 }),
    );
    const insecure = await uploadToImgbb({ apiKey: "k" }, PNG, "x").catch((e) => e);
    expect(insecure.code).toBe("host_no_url");
  });
});
