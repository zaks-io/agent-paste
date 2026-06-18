import * as Sentry from "@sentry/cloudflare";

export type WorkerLogLevel = "info" | "warn" | "error" | "fatal";

export type WorkerLogInput = {
  level: WorkerLogLevel;
  component: string;
  event: string;
  environment?: string | undefined;
  request?: Request | undefined;
  requestId?: string | undefined;
  routeId?: string | undefined;
  actorKind?: string | undefined;
  actorId?: string | undefined;
  workspaceId?: string | undefined;
  attributes?: Record<string, unknown> | undefined;
};

export type WorkerErrorLogInput = Omit<WorkerLogInput, "level"> & {
  error: unknown;
  level?: "error" | "fatal" | undefined;
};

const RESERVED_KEYS = new Set(["level", "component", "event", "at"]);

const SENSITIVE_KEY_PARTS = [
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "secret",
  "token",
  "signature",
  "signedurl",
  "signed_url",
  "url",
  "query",
  "body",
  "blob",
  "fragment",
  "password",
  "credential",
  "idempotencykey",
  "idempotency_key",
];

const API_KEY_PATTERN = /ap_pk_[a-z0-9_:-]+/giu;
const BEARER_PATTERN = /bearer\s+[a-z0-9._~+/=-]+/giu;
const SECRET_ASSIGNMENT_PATTERN =
  /\b((?:content_signing_secret|upload_signing_secret|api_key_pepper_v1|smoke_harness_secret|access_link_blob|content_token|idempotency[-_]?key|signature|token|kid|expires))\s*[:=]\s*[^,\s&]+/giu;
const JSON_SECRET_ASSIGNMENT_PATTERN =
  /"((?:content_signing_secret|upload_signing_secret|api_key_pepper_v1|smoke_harness_secret|access_link_blob|content_token|idempotency[-_]?key|signature|token|kid|expires))"\s*:\s*"(?:\\.|[^"\\])*"/giu;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu;

export function emitWorkerLog(input: WorkerLogInput): void {
  const attributes = workerLogAttributes(input);
  emitConsoleLine(input.level, attributes);
  sendSentryLog(input.level, input.event, attributes);
}

export function captureWorkerError(input: WorkerErrorLogInput): void {
  const level = input.level ?? "error";
  const errorAttributes = {
    ...input.attributes,
    ...errorAttributesFor(input.error),
  };
  const logInput = { ...input, level, attributes: errorAttributes };
  const attributes = workerLogAttributes(logInput);

  emitConsoleLine(level, attributes);

  try {
    Sentry.captureException(input.error, { extra: attributes });
  } catch {
    // Monitoring must never affect request handling.
  }
  sendSentryLog(level, input.event, attributes);
}

export function sanitizeWorkerLogAttributes(
  fields: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  if (!fields) {
    return safe;
  }

  for (const [key, value] of Object.entries(fields)) {
    const normalizedKey = normalizeKey(key);
    if (RESERVED_KEYS.has(key) || isSensitiveKey(normalizedKey)) {
      continue;
    }
    const sanitized = sanitizeScalar(key, value);
    if (sanitized !== undefined) {
      safe[key] = sanitized;
    }
  }
  return safe;
}

export function sanitizeSentryLog<T extends { attributes?: Record<string, unknown>; message?: unknown }>(
  log: T,
): T | null {
  const safe = { ...log };
  if (typeof log.message === "string") {
    safe.message = sanitizeString(log.message) as T["message"];
  }

  const attributes = sanitizeWorkerLogAttributes(log.attributes);
  if (Object.keys(attributes).length === 0) {
    delete safe.attributes;
    return safe;
  }
  return { ...safe, attributes };
}

function workerLogAttributes(input: WorkerLogInput): Record<string, string | number | boolean> {
  return {
    ...sanitizeWorkerLogAttributes(input.attributes),
    component: input.component,
    event: input.event,
    at: new Date().toISOString(),
    ...definedString("environment", input.environment),
    ...requestAttributes(input.request),
    ...definedString("request_id", input.requestId),
    ...definedString("route_id", input.routeId),
    ...definedString("actor_kind", input.actorKind),
    ...definedString("actor_id", input.actorId),
    ...definedString("workspace_id", input.workspaceId),
  };
}

function emitConsoleLine(level: WorkerLogLevel, attributes: Record<string, string | number | boolean>): void {
  try {
    const line = JSON.stringify({ level, ...attributes });
    if (level === "info") {
      console.log(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.error(line);
    }
  } catch (error) {
    try {
      const fallback = `[${attributes.component}] ${attributes.event} (structured log failed: ${errorMessage(error)})`;
      if (level === "info") {
        console.log(fallback);
      } else if (level === "warn") {
        console.warn(fallback);
      } else {
        console.error(fallback);
      }
    } catch {
      // Never throw from logging.
    }
  }
}

function sendSentryLog(
  level: WorkerLogLevel,
  event: string,
  attributes: Record<string, string | number | boolean>,
): void {
  if (level === "info") {
    return;
  }

  try {
    Sentry.logger[level](event, attributes);
  } catch {
    // Sentry may be unavailable outside an instrumented invocation.
  }
}

function requestAttributes(request: Request | undefined): Record<string, string> {
  if (!request) {
    return {};
  }
  return {
    method: request.method,
    path: pathFromUrl(request.url),
  };
}

function definedString(key: string, value: string | undefined): Record<string, string> {
  const trimmed = value?.trim();
  return trimmed ? { [key]: trimmed } : {};
}

function errorAttributesFor(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      error_name: sanitizeString(error.name),
      error_message: sanitizeString(error.message),
    };
  }
  return { error_message: errorMessage(error) };
}

function sanitizeScalar(key: string, value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") {
    const sanitized = normalizeKey(key) === "path" ? pathFromUrl(value) : sanitizeString(value);
    return sanitized.length > 0 ? sanitized : undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return undefined;
}

export function sanitizeString(value: string): string {
  const redacted = value
    .replace(API_KEY_PATTERN, "[redacted_api_key]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(JSON_SECRET_ASSIGNMENT_PATTERN, '"$1":"[redacted]"')
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[redacted]")
    .replace(URL_PATTERN, (match) => `[url:${pathFromUrl(match)}]`);
  return redacted.length > 2048 ? `${redacted.slice(0, 2048)}...[truncated]` : redacted;
}

export function pathFromUrl(raw: string): string {
  try {
    return redactSensitivePath(new URL(raw).pathname);
  } catch {
    const queryStart = raw.search(/[?#]/u);
    return redactSensitivePath(queryStart >= 0 ? raw.slice(0, queryStart) : raw);
  }
}

function redactSensitivePath(path: string): string {
  return path
    .replace(/^\/v\/[^/]+(?=\/|$)/u, "/v/[redacted_content_token]")
    .replace(/^\/b\/[^/]+(?=\/|$)/u, "/b/[redacted_content_token]")
    .replace(/^\/v1\/public\/agent-view\/[^/]+(?=\/|$)/u, "/v1/public/agent-view/[redacted_agent_view_token]");
}

function errorMessage(error: unknown): string {
  return sanitizeString(error instanceof Error ? error.message : String(error));
}

export function isSensitiveKey(normalizedKey: string): boolean {
  return SENSITIVE_KEY_PARTS.some((part) => normalizedKey.includes(part));
}

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9_]/gu, "");
}
