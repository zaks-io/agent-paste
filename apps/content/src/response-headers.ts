import { getRequestId, REQUEST_ID_HEADER } from "@agent-paste/auth";
import { attachmentFilename, CONTENT_SECURITY_HEADERS, servedContentForPath } from "@agent-paste/storage";
import type { ContentTokenPayload } from "@agent-paste/tokens/content";
import { BASELINE_SECURITY_HEADERS, writeArtifactEvent } from "@agent-paste/worker-runtime";
import { CONTENT_CACHE_CONTROL, contentCacheControl } from "./cache-policy.js";
import { isGzipNegotiable, negotiatesGzip } from "./content-encoding.js";
import type { AppContext } from "./env.js";
export const BUNDLE_FILENAME = "bundle.zip";
const securityHeaders = { ...BASELINE_SECURITY_HEADERS, ...CONTENT_SECURITY_HEADERS };
const NOINDEX_HEADER = "noindex, nofollow";
export function bundleResponseHeaders(size: number, noindex: boolean, etag: string): Headers {
  const headers = new Headers(securityHeaders);
  headers.set("cache-control", CONTENT_CACHE_CONTROL);
  headers.set("etag", etag);
  headers.set("content-length", String(size));
  headers.set("content-type", "application/zip");
  headers.set("content-disposition", `attachment; filename="${BUNDLE_FILENAME}"`);
  if (noindex) {
    headers.set("x-robots-tag", NOINDEX_HEADER);
  }
  return headers;
}

export function responseHeadersForPath(
  path: string,
  size: number,
  payload: ContentTokenPayload,
  etag: string,
  request?: Request,
): Headers {
  const scriptDisabled = isScriptDisabled(payload);
  const served = servedContentForPath(path, { scriptDisabled });
  const headers = new Headers(securityHeaders);
  headers.set(
    "cache-control",
    contentCacheControl({ ...served, exp: payload.exp, nowSeconds: Math.floor(Date.now() / 1000) }),
  );
  headers.set("etag", etag);
  headers.set("content-length", String(size));
  headers.set("content-type", served.contentType);
  headers.set("content-security-policy", served.csp);
  if (served.disposition === "attachment" || payload.original_bytes === true) {
    headers.set("content-disposition", `attachment; filename="${attachmentFilename(path)}"`);
  }
  if (payload.noindex === true) {
    headers.set("x-robots-tag", NOINDEX_HEADER);
  }
  if (isGzipNegotiable(path)) {
    appendVary(headers, "Accept-Encoding");
    if (payload.original_bytes !== true && negotiatesGzip(path, request)) {
      headers.set("content-encoding", "gzip");
    }
  }
  applyOpaqueOriginCors(headers, request);
  return headers;
}

function applyOpaqueOriginCors(headers: Headers, request?: Request): void {
  if (request?.headers.get("origin") !== "null") {
    return;
  }
  headers.set("access-control-allow-origin", "null");
  appendVary(headers, "Origin");
}

function appendVary(headers: Headers, value: string): void {
  const current = headers.get("vary");
  if (!current) {
    headers.set("vary", value);
    return;
  }
  if (current === "*") {
    return;
  }
  const exists = current.split(",").some((item) => item.trim().toLowerCase() === value.toLowerCase());
  if (!exists) {
    headers.set("vary", `${current}, ${value}`);
  }
}

// 304 serves no bytes, but the request already counted against the artifact read
// limit, so it still registers a read (bytes: 0). It reuses the exact headers the
// 200 would carry (built by the caller) minus the body-only content-length and
// content-encoding, so the validated cache entry keeps the same CSP,
// content-type, and cache directives instead of inheriting a weaker set from a
// hand-maintained 304 list.
export function notModifiedResponse(context: AppContext, payload: ContentTokenPayload, headers: Headers): Response {
  if (payload.workspace_id) {
    writeArtifactEvent(context.env.ARTIFACT_EVENTS, {
      kind: "read",
      workspaceId: payload.workspace_id,
      artifactId: payload.artifact_id,
      revisionId: payload.revision_id,
      bytes: 0,
      detail: "304",
    });
  }
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set(REQUEST_ID_HEADER, getRequestId(context));
  return new Response(null, { status: 304, headers });
}

export function transformHtmlBytes(bytes: Uint8Array, options: { noindex: boolean }): Uint8Array {
  let html = new TextDecoder().decode(bytes);
  if (options.noindex) html = injectNoindexMeta(html);
  return new TextEncoder().encode(html);
}

export function contentRepresentationKey(path: string, payload: ContentTokenPayload, gzip = false): string | undefined {
  const parts: string[] = [];
  if (payload.original_bytes === true) return "original-download";
  if (isHtmlPath(path)) {
    if (payload.noindex === true) parts.push("noindex");
    parts.push("direct");
    parts.push(isScriptDisabled(payload) ? "script-none" : "script-on");
  }
  // A strong validator must differ per content-coding (RFC 9110 §8.8.3).
  if (gzip) parts.push("gzip");
  return parts.length > 0 ? parts.join(":") : undefined;
}

function isScriptDisabled(payload: ContentTokenPayload): boolean {
  // Before ADR 0095, ephemeral tokens were signed with noindex=true and an
  // explicit script_disabled=false. Keep that existing tier marker fail-closed
  // until every pre-migration token and capability manifest has expired.
  return payload.noindex === true || payload.script_disabled !== false;
}

export function injectNoindexMeta(html: string): string {
  const tag = '<meta name="robots" content="noindex,nofollow">';
  if (html.includes(tag)) {
    return html;
  }
  const headMatch = /<head(\b[^>]*)>/i.exec(html);
  if (headMatch) {
    const index = headMatch.index + headMatch[0].length;
    return `${html.slice(0, index)}${tag}${html.slice(index)}`;
  }
  return `${tag}${html}`;
}

export function isHtmlPath(path: string): boolean {
  return /\.(?:html?|xhtml)$/i.test(path);
}
