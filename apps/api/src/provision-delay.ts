export const DEFAULT_PROVISION_DELAY_MS = 200;

export async function waitForProvisionDelay(rawDelayMs: string | undefined, fallbackMs = DEFAULT_PROVISION_DELAY_MS) {
  const delayMs = nonNegativeInteger(rawDelayMs, fallbackMs);
  if (delayMs <= 0) {
    return;
  }
  const runtimeScheduler = (globalThis as { scheduler?: { wait?: (milliseconds: number) => Promise<void> } }).scheduler;
  if (typeof runtimeScheduler?.wait === "function") {
    await runtimeScheduler.wait(delayMs);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function nonNegativeInteger(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  const parsed = trimmed && /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
