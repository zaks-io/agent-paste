export const MIME_TYPES_BY_EXTENSION = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
} as const;

export const DEFAULT_MIME_TYPE = "application/octet-stream";

export const SECURITY_HEADERS = {
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export type MimeExtension = keyof typeof MIME_TYPES_BY_EXTENSION;

export function contentTypeForPath(path: string): string {
  const extension = path.match(/\.[^./\\]+$/u)?.[0]?.toLowerCase();
  if (extension !== undefined && extension in MIME_TYPES_BY_EXTENSION) {
    return MIME_TYPES_BY_EXTENSION[extension as MimeExtension];
  }

  return DEFAULT_MIME_TYPE;
}

export function responseHeadersForPath(path: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": contentTypeForPath(path),
    ...SECURITY_HEADERS,
    ...extra,
  };
}
