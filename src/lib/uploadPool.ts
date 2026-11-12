/**
 * Bounded-concurrency helper for batch uploads.
 *
 * Uploading 50 images × 2 files sequentially is slow; firing 100 requests at
 * once trips browser connection limits and the Worker rate limiter. A small
 * pool (3–4) keeps throughput high without those failure modes.
 */

export interface PoolTask<T> {
  run: (signal: AbortSignal) => Promise<T>;
  /** used in error messages */
  label: string;
}

export interface PoolResult<T> {
  ok: T[];
  failed: { label: string; error: string }[];
  /** tasks skipped because the pool was aborted */
  skipped: number;
}

export async function runPool<T>(
  tasks: PoolTask<T>[],
  options: {
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<PoolResult<T>> {
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 3));
  const results: PoolResult<T> = { ok: [], failed: [], skipped: 0 };

  // shared index so workers pull the next task instead of chunking up front
  let cursor = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted) {
        results.skipped += tasks.length - cursor;
        return;
      }
      const index = cursor;
      if (index >= tasks.length) return;
      cursor += 1;
      const task = tasks[index];
      try {
        const value = await task.run(options.signal ?? new AbortController().signal);
        results.ok.push(value);
      } catch (error) {
        results.failed.push({
          label: task.label,
          error: error instanceof Error ? error.message : "失败",
        });
      } finally {
        done += 1;
        options.onProgress?.(done, tasks.length);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}
