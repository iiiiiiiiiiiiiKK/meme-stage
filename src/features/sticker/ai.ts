/**
 * Client for the server-side image provider.
 *
 * The browser never sees the API key: every call goes to our own `/api/ai/*`,
 * which holds the secret and stores the result as a normal asset. When the server
 * is not configured, `capabilities()` reports that and the UI stays disabled — it
 * never pretends the feature exists.
 */
import { api } from "../../lib/api";
import { getEditorKey } from "../../lib/ids";
import type { AssetRecord } from "../../lib/types";

export interface AiModel {
  id: string;
  label: string;
  supportsEdit: boolean;
}

export interface AiCapabilities {
  configured: boolean;
  /** the server actually reached the provider and the key works */
  verified?: boolean;
  models: AiModel[];
  sizes: string[];
  reason: string | null;
  /** a transient failure worth retrying; a rejected key is not */
  retryable?: boolean;
}

export interface AiResult {
  asset: AssetRecord;
  requestId: string | null;
  size: string | null;
  /** provider usage numbers; keys vary by model, so this stays loose */
  usage: Record<string, number> | null;
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "X-Editor-Key": getEditorKey(), ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = (payload ?? {}) as { message?: string; error?: string };
    throw new Error(error.message ?? `请求失败（${response.status}）`);
  }
  return payload as T;
}

export const aiApi = {
  capabilities(): Promise<AiCapabilities> {
    return call<AiCapabilities>("/api/ai/capabilities", { cache: "no-store" });
  },

  generate(input: {
    prompt: string;
    model?: string;
    size?: string;
    background?: "transparent" | "opaque" | "auto";
    name?: string;
    idempotencyKey?: string;
  }): Promise<AiResult> {
    return call<AiResult>("/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  /** style-transfer an existing sticker; the file is the reference image */
  edit(input: {
    file: Blob;
    name: string;
    prompt: string;
    model?: string;
    size?: string;
    background?: "transparent" | "opaque" | "auto";
    idempotencyKey?: string;
  }): Promise<AiResult> {
    const form = new FormData();
    form.append("file", input.file, input.name);
    form.append("prompt", input.prompt);
    form.append("name", input.name);
    if (input.model) form.append("model", input.model);
    if (input.size) form.append("size", input.size);
    if (input.background) form.append("background", input.background);
    if (input.idempotencyKey) form.append("idempotencyKey", input.idempotencyKey);
    return call<AiResult>("/api/ai/edit", { method: "POST", body: form });
  },
};

/** Human-readable usage summary; never invents a price. */
export function usageSummary(usage: Record<string, number> | null): string {
  if (!usage) return "用量未返回";
  const total = usage.total_tokens ?? usage.completion_tokens ?? null;
  if (total === null) return "用量未返回";
  return `${total.toLocaleString("en-US")} tokens（具体金额以服务商账单为准）`;
}

/** Re-exported so callers can reuse the same asset uploader. */
export { api };
