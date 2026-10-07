import * as Sentry from "@sentry/cloudflare";

const JOB_MESSAGE_TYPES = new Set(["byte.purge.v1", "bundle.generate.v1", "safety.scan.v1"]);
const SENTRY_TRACE_PATTERN = /^[0-9a-f]{32}-[0-9a-f]{16}-[01]$/i;
const MAX_BAGGAGE_LENGTH = 8192;
// Transaction names and arbitrary application baggage can contain bearer URLs.
const BAGGAGE_KEYS = new Set([
  "environment",
  "release",
  "public_key",
  "trace_id",
  "org_id",
  "sample_rate",
  "sampled",
  "sample_rand",
]);

type QueueTraceContext = { "sentry-trace": string; baggage?: string };
type SendQueue = { send(message: unknown): unknown };

export function withQueueTraceContext<T extends SendQueue>(queue: T): T {
  return new Proxy(queue, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === "send" && typeof value === "function") {
        return (message: unknown, ...args: unknown[]) =>
          Reflect.apply(value, target, [attachTraceContext(message), ...args]);
      }
      if (property === "sendBatch" && typeof value === "function") {
        return (messages: Iterable<{ body: unknown }>, ...args: unknown[]) =>
          Reflect.apply(value, target, [
            Array.from(messages, (message) => ({ ...message, body: attachTraceContext(message.body) })),
            ...args,
          ]);
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function withQueueMessageTrace<T>(body: unknown, queueName: string, handler: () => T): T {
  const context = readTraceContext(body);
  return Sentry.withIsolationScope(() => {
    const run = () =>
      Sentry.startSpan(
        {
          name: `process ${queueName}`,
          op: "queue.process",
          attributes: {
            "messaging.system": "cloudflare",
            "messaging.destination.name": queueName,
            "messaging.operation.type": "process",
            "sentry.source": "task",
          },
        },
        handler,
      );
    return context
      ? Sentry.continueTrace({ sentryTrace: context["sentry-trace"], baggage: context.baggage }, run)
      : Sentry.startNewTrace(run);
  });
}

function attachTraceContext(body: unknown): unknown {
  if (!isRecord(body) || typeof body.type !== "string" || !JOB_MESSAGE_TYPES.has(body.type)) {
    return body;
  }
  const { trace_context: _previousContext, ...message } = body;
  const generated = Sentry.getTraceData();
  const trace = generated["sentry-trace"];
  if (!trace || !SENTRY_TRACE_PATTERN.test(trace)) {
    return message;
  }
  const baggage = safeBaggage(generated.baggage);
  return { ...message, trace_context: { "sentry-trace": trace, ...(baggage ? { baggage } : {}) } };
}

function readTraceContext(body: unknown): QueueTraceContext | undefined {
  if (!isRecord(body) || !isRecord(body.trace_context)) {
    return undefined;
  }
  const context = body.trace_context;
  const trace = context["sentry-trace"];
  if (typeof trace !== "string" || !SENTRY_TRACE_PATTERN.test(trace)) {
    return undefined;
  }
  if (
    context.baggage !== undefined &&
    (typeof context.baggage !== "string" || context.baggage.length > MAX_BAGGAGE_LENGTH)
  ) {
    return undefined;
  }
  const baggage = safeBaggage(context.baggage as string | undefined);
  return { "sentry-trace": trace, ...(baggage ? { baggage } : {}) };
}

function safeBaggage(value: string | undefined): string | undefined {
  if (!value || value.length > MAX_BAGGAGE_LENGTH || hasControlCharacters(value)) {
    return undefined;
  }
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => {
      const match = /^sentry-([a-z_]+)=([^,;]+)$/.exec(entry);
      if (!match || !BAGGAGE_KEYS.has(match[1] ?? "")) {
        return false;
      }
      try {
        const decoded = decodeURIComponent(match[2] ?? "");
        return !hasControlCharacters(decoded);
      } catch {
        return false;
      }
    });
  return entries.length > 0 ? entries.join(",") : undefined;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
