import type { Breadcrumb, CloudflareOptions, ErrorEvent } from "@sentry/cloudflare";
import { contentCapabilityIdFromValue, isSensitiveKey, normalizeKey, pathFromUrl, sanitizeString } from "./logging.js";

type SentrySpan = Parameters<NonNullable<CloudflareOptions["beforeSendSpan"]>>[0];
type SentryTraceContext = NonNullable<NonNullable<ErrorEvent["contexts"]>["trace"]>;
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/iu;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/iu;
const TRACE_ID_PSEUDONYMS = new Map<string, string>();
const MAX_TRACE_ID_PSEUDONYMS = 4096;

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  const safe: ErrorEvent = { ...event };
  const capabilityId =
    typeof event.request?.url === "string" ? contentCapabilityIdFromValue(event.request.url) : undefined;
  const capabilityRequest = capabilityId !== undefined;
  if (event.transaction !== undefined) {
    safe.transaction = capabilityRequest ? "[redacted_capability_request]" : sanitizeString(event.transaction);
  }
  if (event.message !== undefined) {
    safe.message = sanitizeString(event.message);
  }
  if (event.logentry) {
    safe.logentry = { ...event.logentry };
    if (event.logentry.message !== undefined) {
      safe.logentry.message = sanitizeString(event.logentry.message);
    }
    if (event.logentry.params) {
      safe.logentry.params = event.logentry.params
        .map((value) => sanitizeSentryValue("", value))
        .filter((value) => value !== undefined);
    }
  }
  if (event.exception) {
    safe.exception = { ...event.exception };
    if (event.exception.values) {
      safe.exception.values = event.exception.values.map((value) => {
        const safeValue = { ...value };
        if (value.type !== undefined) {
          safeValue.type = sanitizeString(value.type);
        }
        if (value.value !== undefined) {
          safeValue.value = sanitizeString(value.value);
        }
        return safeValue;
      });
    }
  }
  if (event.request) {
    safe.request = sanitizeSentryRequest(event.request);
  }
  delete safe.user;
  if (event.breadcrumbs) {
    safe.breadcrumbs = event.breadcrumbs.map(sanitizeSentryBreadcrumb);
  }
  if (event.contexts) {
    const contexts = sanitizeSentryRecord(event.contexts) as NonNullable<ErrorEvent["contexts"]>;
    const trace = event.contexts.trace;
    if (trace) {
      contexts.trace = pseudonymizeTraceContext(contexts.trace, trace);
    }
    safe.contexts = contexts;
  }
  if (event.extra) {
    safe.extra = sanitizeSentryRecord(event.extra);
  }
  if (event.tags) {
    safe.tags = sanitizeSentryRecord(event.tags) as NonNullable<ErrorEvent["tags"]>;
  }
  if (event.spans) {
    safe.spans = event.spans.map((span) => sanitizeSentrySpan(span, capabilityId));
  }
  return safe;
}

export function sanitizeSentrySpan(span: SentrySpan, knownCapabilityId?: string): SentrySpan {
  const capabilityId =
    knownCapabilityId ??
    (span.description !== undefined ? contentCapabilityIdFromValue(span.description) : undefined) ??
    Object.values(span.data).reduce<string | undefined>(
      (found, value) => found ?? (typeof value === "string" ? contentCapabilityIdFromValue(value) : undefined),
      undefined,
    );
  const traceId = pseudonymizeTraceId(span.trace_id);
  const profileId = span.profile_id ? pseudonymizeTraceId(span.profile_id) : undefined;
  const segmentId = span.segment_id ? pseudonymizeTraceId(span.segment_id) : undefined;
  if (capabilityId) {
    return {
      ...span,
      trace_id: traceId,
      ...(profileId ? { profile_id: profileId } : {}),
      ...(segmentId ? { segment_id: segmentId } : {}),
      description: "[redacted_capability_request]",
      data: {},
      links: [],
    };
  }
  return {
    ...span,
    trace_id: traceId,
    ...(profileId ? { profile_id: profileId } : {}),
    ...(segmentId ? { segment_id: segmentId } : {}),
    ...(span.description !== undefined ? { description: sanitizeString(span.description) } : {}),
    data: sanitizeSentryRecord(span.data) as SentrySpan["data"],
    ...(span.links ? { links: [] } : {}),
  };
}

function pseudonymizeTraceId(traceId: string): string {
  if (!TRACE_ID_PATTERN.test(traceId)) {
    return sanitizeString(traceId);
  }
  const normalized = traceId.toLowerCase();
  const existing = TRACE_ID_PSEUDONYMS.get(normalized);
  if (existing) {
    return existing;
  }
  if (TRACE_ID_PSEUDONYMS.size >= MAX_TRACE_ID_PSEUDONYMS) {
    const oldest = TRACE_ID_PSEUDONYMS.keys().next().value;
    if (oldest !== undefined) {
      TRACE_ID_PSEUDONYMS.delete(oldest);
    }
  }
  let replacement = crypto.randomUUID().replaceAll("-", "");
  while (replacement === normalized) {
    replacement = crypto.randomUUID().replaceAll("-", "");
  }
  TRACE_ID_PSEUDONYMS.set(normalized, replacement);
  return replacement;
}

function sanitizeSentryRequest(request: NonNullable<ErrorEvent["request"]>): NonNullable<ErrorEvent["request"]> {
  const safe = sanitizeSentryRecord({ ...request }) as NonNullable<ErrorEvent["request"]>;
  if (request.url) {
    safe.url = pathFromUrl(request.url);
  }
  delete safe.cookies;
  delete safe.data;
  delete safe.query_string;
  return safe;
}

function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const safe: Breadcrumb = { ...breadcrumb };
  if (breadcrumb.message !== undefined) {
    safe.message = sanitizeString(breadcrumb.message);
  }
  if (breadcrumb.data) {
    safe.data = sanitizeSentryRecord(breadcrumb.data);
  }
  return safe;
}

function sanitizeSentryRecord(fields: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const sanitized = sanitizeSentryValue(key, value, depth);
    if (sanitized !== undefined) {
      safe[key] = sanitized;
    }
  }
  return safe;
}

function sanitizeSentryValue(key: string, value: unknown, depth = 0): unknown {
  const normalizedKey = normalizeKey(key);
  if (isSensitiveKey(normalizedKey)) {
    return normalizedKey === "url" && typeof value === "string" ? pathFromUrl(value) : undefined;
  }
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "boolean" || value === null) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (depth >= 3) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => sanitizeSentryValue(key, item, depth + 1)).filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (typeof value === "object" && value) {
    const record = sanitizeSentryRecord(value as Record<string, unknown>, depth + 1);
    return Object.keys(record).length > 0 ? record : undefined;
  }
  return undefined;
}

function pseudonymizeTraceContext(
  safeTrace: SentryTraceContext | undefined,
  trace: SentryTraceContext,
): SentryTraceContext {
  const restored = { ...safeTrace };
  if (typeof trace.trace_id === "string" && TRACE_ID_PATTERN.test(trace.trace_id)) {
    restored.trace_id = pseudonymizeTraceId(trace.trace_id);
  }
  if (typeof trace.span_id === "string" && SPAN_ID_PATTERN.test(trace.span_id)) {
    restored.span_id = trace.span_id;
  }
  if (typeof trace.parent_span_id === "string" && SPAN_ID_PATTERN.test(trace.parent_span_id)) {
    restored.parent_span_id = trace.parent_span_id;
  }
  return restored as SentryTraceContext;
}
