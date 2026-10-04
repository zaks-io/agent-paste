import * as Sentry from "@sentry/cloudflare";
import { describe, expect, it, vi } from "vitest";
import { withQueueMessageTrace, withQueueTraceContext } from "./sentry-queue.js";

const TRACE_A = "00112233445566778899aabbccddeeff";
const TRACE_B = "ffeeddccbbaa99887766554433221100";
const PARENT = "1122334455667788";
const JOB = { type: "bundle.generate.v1", workspace_id: "workspace", revision_id: "revision" };

async function inWorker(run: () => Promise<void> | void): Promise<void> {
  const pending: Promise<unknown>[] = [];
  const worker = Sentry.withSentry(
    () => ({
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "test",
      tracesSampleRate: 1,
      defaultIntegrations: [],
      skipOpenTelemetrySetup: true,
      transport: () => ({ send: async () => ({ statusCode: 200 }), flush: async () => true }),
    }),
    {
      async fetch() {
        await run();
        return new Response("ok");
      },
    },
  );
  await worker.fetch(
    new Request("https://api.test/jobs"),
    {},
    {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
      passThroughOnException: () => {},
    },
  );
  await Promise.all(pending);
}

function activeSpan() {
  const span = Sentry.getActiveSpan();
  if (!span) throw new Error("active_span_missing");
  return Sentry.spanToJSON(span);
}

describe("queue trace propagation", () => {
  it("restores the producer trace, parent, and sampling baggage with the real SDK", async () => {
    await inWorker(async () => {
      let payload: unknown;
      const queue = withQueueTraceContext({
        send: async (message: unknown) => {
          payload = message;
        },
      });
      let producer!: ReturnType<typeof activeSpan>;
      await Sentry.continueTrace(
        {
          sentryTrace: `${TRACE_A}-${PARENT}-1`,
          baggage: `sentry-trace_id=${TRACE_A},sentry-environment=preview,sentry-sample_rate=0.25,sentry-sampled=true`,
        },
        () =>
          Sentry.startSpan({ name: "publish" }, async () => {
            producer = activeSpan();
            await queue.send(JOB);
          }),
      );
      await withQueueMessageTrace(payload, "bundle-generate", async () => {
        expect(activeSpan()).toMatchObject({ trace_id: TRACE_A, parent_span_id: producer.span_id });
        expect(Sentry.getTraceData().baggage).toContain("sentry-environment=preview");
        expect(Sentry.getTraceData()["sentry-trace"]).toMatch(/-1$/);
      });
      expect(JOB).not.toHaveProperty("trace_context");
    });
  });

  it("inherits an unsampled producer despite the consumer's sample rate of one", async () => {
    await inWorker(() =>
      withQueueMessageTrace(
        {
          ...JOB,
          trace_context: { "sentry-trace": `${TRACE_A}-${PARENT}-0` },
        },
        "bundle-generate",
        () => {
          expect(activeSpan()).toMatchObject({ trace_id: TRACE_A, parent_span_id: PARENT });
          expect(Sentry.getTraceData()["sentry-trace"]).toMatch(/-0$/);
        },
      ),
    );
  });

  it("keeps mixed messages independent and retries attached to the original producer", async () => {
    await inWorker(async () => {
      const outer = activeSpan();
      const messages = [TRACE_A, TRACE_B].map((trace) => ({
        ...JOB,
        trace_context: { "sentry-trace": `${trace}-${PARENT}-1` },
      }));
      for (const [index, body] of messages.entries()) {
        await withQueueMessageTrace(body, "bundle-generate", async () => {
          await Promise.resolve();
          expect(activeSpan()).toMatchObject({ trace_id: index === 0 ? TRACE_A : TRACE_B, parent_span_id: PARENT });
        });
        expect(activeSpan().trace_id).toBe(outer.trace_id);
      }
      await withQueueMessageTrace(messages[0], "bundle-generate", () => {
        expect(activeSpan()).toMatchObject({ trace_id: TRACE_A, parent_span_id: PARENT });
      });
      await withQueueMessageTrace(JOB, "bundle-generate", () => {
        expect(activeSpan().trace_id).not.toBe(outer.trace_id);
        expect(activeSpan().parent_span_id).toBeUndefined();
      });
    });
  });

  it("processes old and malformed metadata without inheriting the batch trace", async () => {
    await inWorker(async () => {
      const batchTrace = activeSpan().trace_id;
      const bodies = [
        JOB,
        null,
        { ...JOB, trace_context: false },
        {
          ...JOB,
          trace_context: { "sentry-trace": "invalid" },
        },
        {
          ...JOB,
          trace_context: { "sentry-trace": `${TRACE_A}-${PARENT}-1`, baggage: "a".repeat(8193) },
        },
      ];
      for (const body of bodies) {
        await withQueueMessageTrace(body, "byte-purge", () => {
          expect(activeSpan().trace_id).not.toBe(batchTrace);
          expect(activeSpan().parent_span_id).toBeUndefined();
        });
      }
    });
  });

  it("keeps thrown errors unchanged and restores the outer context", async () => {
    await inWorker(async () => {
      const outer = activeSpan();
      const failure = new Error("job_failed");
      await expect(
        withQueueMessageTrace(JOB, "byte-purge", async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(activeSpan().span_id).toBe(outer.span_id);
    });
  });

  it("preserves send and sendBatch receivers, options, results, and business data", async () => {
    await inWorker(() => {
      const result = Promise.resolve("sent");
      const options = { delaySeconds: 5 };
      const queue = {
        send: vi.fn(function (this: unknown, _body: unknown, _options?: typeof options) {
          expect(this).toBe(queue);
          return result;
        }),
        sendBatch: vi.fn(function (this: unknown, _messages: Iterable<{ body: unknown }>, _options?: typeof options) {
          expect(this).toBe(queue);
          return result;
        }),
      };
      const wrapped = withQueueTraceContext(queue);
      expect(wrapped.send(JOB, options)).toBe(result);
      expect(queue.send.mock.calls[0]?.[1]).toBe(options);
      expect(queue.send.mock.calls[0]?.[0]).toMatchObject({
        ...JOB,
        trace_context: { "sentry-trace": expect.any(String) },
      });
      const original = [{ body: JOB, delaySeconds: 7 }];
      expect(wrapped.sendBatch(original, options)).toBe(result);
      expect(queue.sendBatch.mock.calls[0]?.[1]).toBe(options);
      expect(queue.sendBatch.mock.calls[0]?.[0]).toMatchObject([
        { delaySeconds: 7, body: { ...JOB, trace_context: expect.any(Object) } },
      ]);
      expect(original[0]?.body).toBe(JOB);
      const unrelated = { type: "other.v1", value: "untouched" };
      wrapped.send(unrelated);
      expect(queue.send.mock.calls[1]?.[0]).toBe(unrelated);
    });
  });

  it("carries only bounded sampling baggage and replaces caller-supplied metadata", async () => {
    await inWorker(() =>
      Sentry.continueTrace(
        {
          sentryTrace: `${TRACE_A}-${PARENT}-1`,
          baggage: "sentry-environment=preview,sentry-transaction=secret-url,private-data=secret,sentry-user_id=secret",
        },
        () =>
          Sentry.startSpan({ name: "publish" }, () => {
            let payload: unknown;
            withQueueTraceContext({
              send: (body: unknown) => {
                payload = body;
              },
            }).send({
              ...JOB,
              trace_context: { "sentry-trace": "caller-value", baggage: "private-data=secret" },
            });
            expect(payload).toMatchObject({
              trace_context: { baggage: expect.stringContaining("sentry-environment=preview") },
            });
            expect(JSON.stringify(payload)).not.toContain("secret");
            expect(JSON.stringify(payload)).not.toContain("caller-value");
          }),
      ),
    );
  });
});
