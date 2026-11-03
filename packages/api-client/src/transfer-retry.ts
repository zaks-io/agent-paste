import type { IdempotencyKey } from "@agent-paste/contracts/primitives";

export async function operationKey(base: string, suffix: string): Promise<IdempotencyKey> {
  return `transfer_${await digestBytes(new TextEncoder().encode(`${base}:${suffix}`))}` as IdempotencyKey;
}
export async function digestBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}
export function errorFields(error: unknown): { status?: number; code?: string; retryAfterSeconds?: number } {
  return error && typeof error === "object" ? error : {};
}
export async function transferRetry<T>(run: () => Promise<T>, sleep = delay): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const { status, code, retryAfterSeconds } = errorFields(error);
      if (
        attempt >= 4 ||
        code === "commit_conflict" ||
        code === "local_file_changed" ||
        (status !== undefined &&
          status < 500 &&
          !(status === 429 && retryAfterSeconds !== undefined) &&
          code !== "idempotency_in_flight")
      )
        throw error;
      if (status === undefined && !(error instanceof TypeError)) throw error;
      await sleep(
        retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : 250 * 2 ** attempt * (0.5 + Math.random()),
      );
    }
  }
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function runConcurrent<T>(items: T[], run: (item: T) => Promise<void>, concurrency = 6): Promise<void> {
  let next = 0;
  let failure: unknown;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(items.length, concurrency) }, async () => {
      while (!failed) {
        const item = items[next++];
        if (item === undefined) return;
        try {
          await run(item);
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
        }
      }
    }),
  );
  if (failed) throw failure;
}
