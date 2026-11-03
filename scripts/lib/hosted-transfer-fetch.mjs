// @ts-check
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { hostedTransferRequestKind } from "./transfer-endpoints.mjs";

// Test-only transport policy. Server limits and the public clients stay unchanged.
export function hostedTransferFetch(
  config,
  apiKey,
  { fetchImpl = fetch, sleep = delay, onEvent = (_event) => {} } = {},
) {
  return async (input, init) => {
    const kind = hostedTransferRequestKind(config, input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    assert(!headers.has("cookie"), "Hosted acceptance must not send cookies");
    if (kind === "content" || kind === "capability") {
      assert(
        ["GET", "HEAD"].includes(method) && !headers.has("authorization"),
        "Content reads must carry no API credential",
      );
    } else {
      assert(["GET", "HEAD", "POST", "PUT"].includes(method), "Unexpected hosted transfer method");
      const auth = headers.get("authorization");
      assert(
        auth === `Bearer ${apiKey}` || (kind === "upload" && method === "PUT" && !auth),
        "Use only the provisioned workspace key",
      );
    }
    assert(!(input instanceof Request && input.body), "Hosted acceptance requires a replayable request body");
    const signal = AbortSignal.any([
      ...(init?.signal ? [init.signal] : input instanceof Request ? [input.signal] : []),
      AbortSignal.timeout(300_000),
    ]);
    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(input, { ...init, signal, redirect: "error" });
      onEvent({ type: "hosted_request", kind, status: response.status });
      if (response.status !== 429) return response;
      const raw = response.headers.get("retry-after");
      const seconds =
        raw && /^\d+$/.test(raw) ? Number(raw) : raw ? Math.ceil((Date.parse(raw) - Date.now()) / 1000) : NaN;
      if (attempt === 4 || !Number.isSafeInteger(seconds) || seconds < 0 || seconds > 120) {
        await response.body?.cancel();
        // Stop the client's own retry loop too: the test's retry budget is spent.
        throw new Error("Hosted transfer Retry-After is missing, excessive, or exhausted");
      }
      assert(
        !init?.body || typeof init.body === "string" || init.body instanceof Uint8Array,
        "Cannot retry this body safely",
      );
      await response.body?.cancel();
      const waitMs = Math.max(1000, seconds * 1000);
      onEvent({ type: "hosted_retry", wait_ms: waitMs });
      await sleep(waitMs, undefined, { signal });
    }
  };
}
