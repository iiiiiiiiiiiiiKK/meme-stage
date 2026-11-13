/**
 * Per-browser AI key state — shared, not per-component.
 *
 * The settings panel and both AI panels each render this hook. If it kept state
 * locally, typing a key would only enable the panel you typed it into. A single
 * module store is the correct scope here: one browser, one key.
 */
import { create } from "zustand";
import {
  KNOWN_MODELS,
  AiKeyError,
  clearStoredBase,
  clearStoredKey,
  probeKey,
  readStoredBase,
  readStoredKey,
  readStoredModel,
  saveStoredBase,
  saveStoredKey,
  saveStoredModel,
} from "./byok";

interface AiKeyStore {
  key: string | null;
  /** OpenAI-compatible endpoint the key belongs to. */
  base: string;
  models: string[];
  model: string;
  verified: boolean | null;
  probing: boolean;
  error: string | null;
  retryable: boolean;
  save: (value: string) => Promise<boolean>;
  setBase: (value: string) => Promise<boolean>;
  forget: () => void;
  setModel: (value: string) => void;
  retry: () => void;
  /** re-probe on first mount of any panel */
  hydrate: () => void;
}

let hydrated = false;

export const useAiKeyStore = create<AiKeyStore>((set, get) => ({
  key: readStoredKey(),
  base: readStoredBase(),
  models: [],
  model: readStoredModel() ?? KNOWN_MODELS[0],
  verified: null,
  probing: false,
  error: null,
  retryable: false,

  hydrate: () => {
    if (hydrated) return;
    hydrated = true;
    const stored = get().key;
    if (stored) void get().save(stored);
  },

  save: async (value) => {
    const trimmed = value.trim();
    if (!saveStoredKey(trimmed)) {
      set({ verified: false, retryable: false, error: "密钥格式看起来不对，请检查是否复制完整" });
      return false;
    }
    set({ key: trimmed, probing: true, error: null });
    try {
      const { models } = await probeKey(trimmed);
      if (models.length === 0) {
        set({ verified: false, retryable: false, models: [], error: "这个密钥没有任何可用模型" });
        return true;
      }
      const current = get().model;
      const next = models.includes(current) ? current : models[0];
      saveStoredModel(next);
      set({ models, model: next, verified: true, retryable: false, error: null });
      return true;
    } catch (err) {
      // A rejected key is permanent until replaced; a network/limit failure is not.
      const keyProblem = err instanceof AiKeyError && (err.status === 401 || err.status === 403);
      set({
        verified: false,
        retryable: !keyProblem,
        error: err instanceof Error ? err.message : "无法验证密钥",
      });
      return true;
    } finally {
      set({ probing: false });
    }
  },

  setBase: async (value) => {
    const clean = saveStoredBase(value);
    if (!clean) {
      set({ error: "接口地址需要是完整的 http(s) 链接，例如 https://api.openai.com/v1" });
      return false;
    }
    set({ base: clean, models: [], verified: null, error: null });
    const stored = get().key;
    if (stored) await get().save(stored);
    return true;
  },

  forget: () => {
    clearStoredKey();
    clearStoredBase();
    set({ key: null, base: readStoredBase(), models: [], verified: null, error: null, retryable: false, probing: false });
  },

  setModel: (value) => {
    saveStoredModel(value);
    set({ model: value });
  },

  retry: () => {
    const stored = readStoredKey();
    if (stored) void get().save(stored);
  },
}));

/** Convenience selector so panels read the same shape they used before. */
export function useAiKey() {
  const store = useAiKeyStore();
  return {
    key: store.key,
    base: store.base,
    models: store.models,
    model: store.model,
    verified: store.verified,
    probing: store.probing,
    error: store.error,
    retryable: store.retryable,
    setKey: store.save,
    setBase: store.setBase,
    forget: store.forget,
    setModel: store.setModel,
    retry: store.retry,
  };
}

/** AI is usable only when a key is stored and it has not failed verification. */
export function aiReady(state: { key: string | null; verified: boolean | null; error: string | null }): boolean {
  return Boolean(state.key) && state.verified !== false && !state.error;
}
