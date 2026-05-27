import * as Sentry from "@sentry/cloudflare";

const RESERVED_KEYS = new Set(["level", "component", "event", "at"]);

function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!RESERVED_KEYS.has(key)) {
      safe[key] = value;
    }
  }
  return safe;
}

function emitLog(level: "info" | "error", event: string, fields: Record<string, unknown>): void {
  try {
    const line = JSON.stringify({
      level,
      component: "jobs",
      event,
      at: new Date().toISOString(),
      ...sanitizeFields(fields),
    });
    if (level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  } catch (error) {
    try {
      Sentry.captureException(error);
    } catch {
      // Sentry may be unavailable outside an instrumented request.
    }
    try {
      const fallback = `[jobs] ${event} (structured log failed: ${error instanceof Error ? error.message : String(error)})`;
      if (level === "error") {
        console.error(fallback);
      } else {
        console.log(fallback);
      }
    } catch {
      // Never throw from operator logging.
    }
  }
}

export function logOp(event: string, fields: Record<string, unknown>): void {
  emitLog("info", event, fields);
}

export function logOpError(event: string, fields: Record<string, unknown>): void {
  emitLog("error", event, fields);
}
