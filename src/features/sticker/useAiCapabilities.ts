/**
 * Shared capability probe for both AI panels.
 *
 * Two panels used to fetch `/api/ai/capabilities` independently and each turned
 * *any* failure into "not configured" for the rest of the mount. That made a
 * transient 429 or a dropped connection look like a permanently disabled feature,
 * with no way to retry short of reloading the page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { aiApi, type AiCapabilities } from "./ai";

export interface AiCapabilityState {
  caps: AiCapabilities | null;
  loading: boolean;
  /** true when a retry is worth offering */
  canRetry: boolean;
  refresh: () => void;
}

/**
 * Short-lived memo.
 *
 * Both panels mount on the same page, and every probe costs an upstream
 * `/v1/models` call. Caching for a few seconds collapses the two mounts into one
 * request; the explicit "重新检查" button bypasses it.
 */
let cached: { at: number; value: AiCapabilities } | null = null;
const CACHE_MS = 20_000;

export function invalidateAiCapabilities(): void {
  cached = null;
}

export function useAiCapabilities(): AiCapabilityState {
  const [caps, setCaps] = useState<AiCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [canRetry, setCanRetry] = useState(false);
  const alive = useRef(true);

  const load = useCallback((force = false) => {
    setLoading(true);
    if (!force && cached && Date.now() - cached.at < CACHE_MS) {
      setCaps(cached.value);
      setCanRetry(cached.value.retryable === true || cached.value.verified === false);
      setLoading(false);
      return;
    }
    void aiApi
      .capabilities()
      .then((value) => {
        // Only cache a definite answer: a transient failure should be re-probed by
        // the next panel rather than pinned for 20 seconds.
        if (value.verified !== false) cached = { at: Date.now(), value };
        if (!alive.current) return;
        setCaps(value);
        // A configured-but-unverified provider is a temporary fault, not a
        // missing configuration: keep that distinction so the UI can say so.
        setCanRetry(value.retryable === true || value.verified === false);
      })
      .catch(() => {
        if (!alive.current) return;
        setCaps({
          configured: false,
          verified: false,
          models: [],
          sizes: [],
          reason: "无法读取图像服务状态",
          retryable: true,
        });
        setCanRetry(true);
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  return { caps, loading, canRetry, refresh: () => load(true) };
}

/**
 * Can the panel actually run?
 *
 * `configured` alone is not enough: the server sets it from the environment, and a
 * revoked key or a rate-limited gateway still looks configured. Requiring a usable
 * model also keeps the UI honest after `models: []`.
 */
export function aiReady(caps: AiCapabilities | null): boolean {
  if (!caps) return false;
  if (!caps.configured) return false;
  if (caps.verified === false) return false;
  return caps.models.length > 0;
}
