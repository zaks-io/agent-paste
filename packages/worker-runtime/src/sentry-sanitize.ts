import type { Breadcrumb, ErrorEvent } from "@sentry/cloudflare";
import { isSensitiveKey, normalizeKey, pathFromUrl, sanitizeString } from "./logging.js";

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  const safe: ErrorEvent = { ...event };
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
  if (event.breadcrumbs) {
    safe.breadcrumbs = event.breadcrumbs.map(sanitizeSentryBreadcrumb);
  }
  if (event.contexts) {
    safe.contexts = sanitizeSentryRecord(event.contexts) as NonNullable<ErrorEvent["contexts"]>;
  }
  if (event.extra) {
    safe.extra = sanitizeSentryRecord(event.extra);
  }
  return safe;
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
