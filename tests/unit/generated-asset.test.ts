import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GeneratedAssetError,
  MAX_GENERATED_IMAGE_BYTES,
  storeGeneratedImage,
} from "../../functions/_lib/generatedAsset";
import { MAX_ASSETS_PER_OWNER, SIZE_LIMITS } from "../../functions/_lib/files";

/** Minimal fake Env: one R2 put/delete pair and a D1 stub with a row count. */
function makeEnv(options: { count?: number; dbThrows?: boolean } = {}) {
  const stored = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const inserted: unknown[][] = [];
  const env = {
    BUCKET: {
      put: async (key: string, bytes: Uint8Array) => {
        stored.set(key, bytes);
      },
      delete: async (key: string) => {
        deleted.push(key);
        stored.delete(key);
      },
    },
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            if (options.dbThrows) throw new Error("d1 down");
            return { n: options.count ?? 0 };
          },
          run: async () => {
            if (/INSERT/.test(sql)) inserted.push(args);
            return { success: true };
          },
        }),
      }),
    },
  };
  return { env: env as never, stored, deleted, inserted };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)]);

const BASE = {
  owner: "a".repeat(64),
  mime: "image/png",
  ext: "png",
  name: "AI 贴纸",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generated asset storage", () => {
  it("writes R2 and D1 and returns the same URL shape as an upload", async () => {
    const { env, stored, inserted } = makeEnv();
    const asset = await storeGeneratedImage(env, { ...BASE, bytes: PNG });
    expect(asset.url).toBe(`/api/files/${asset.id}`);
    expect(asset.mime).toBe("image/png");
    expect(asset.size).toBe(PNG.byteLength);
    expect(stored.size).toBe(1);
    expect(inserted).toHaveLength(1);
  });

  it("applies the same image size ceiling as a normal upload", async () => {
    const { env, stored } = makeEnv();
    const oversized = new Uint8Array(MAX_GENERATED_IMAGE_BYTES + 1);
    const error = await storeGeneratedImage(env, { ...BASE, bytes: oversized }).catch((e) => e);
    expect(error).toBeInstanceOf(GeneratedAssetError);
    expect(error.status).toBe(413);
    expect(error.code).toBe("result_too_large");
    expect(stored.size).toBe(0);
  });

  it("shares the per-owner asset ceiling with the upload path", async () => {
    const { env, stored } = makeEnv({ count: MAX_ASSETS_PER_OWNER });
    const error = await storeGeneratedImage(env, { ...BASE, bytes: PNG }).catch((e) => e);
    expect(error.code).toBe("quota");
    expect(stored.size).toBe(0);
  });

  it("still stores the paid result when the quota count query fails", async () => {
    const { env, stored } = makeEnv({ dbThrows: true });
    const asset = await storeGeneratedImage(env, { ...BASE, bytes: PNG });
    expect(asset.id).toBeTruthy();
    expect(stored.size).toBe(1);
  });

  it("rejects an empty payload before touching storage", async () => {
    const { env, stored } = makeEnv();
    const error = await storeGeneratedImage(env, { ...BASE, bytes: new Uint8Array() }).catch((e) => e);
    expect(error.code).toBe("result_empty");
    expect(stored.size).toBe(0);
  });

  it("keeps the generated image limit aligned with the uploaded image limit", () => {
    expect(MAX_GENERATED_IMAGE_BYTES).toBe(SIZE_LIMITS.image);
  });
});
