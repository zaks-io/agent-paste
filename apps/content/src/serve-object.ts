import { getRequestId, REQUEST_ID_HEADER } from "@agent-paste/auth";
import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import {
  attachmentFilename,
  bytesFromReadableBody,
  CONTENT_SECURITY_HEADERS,
  decryptArtifactBytesWithKeyRing,
  isArtifactBytesEncryptionMetadata,
  parseRevisionFileObjectKey,
  parseWorkspaceBlobObjectKey,
  plaintextByteLengthFromStoredObject,
  servedContentForPath,
  withFrameAncestors,
} from "@agent-paste/storage";
import type { ContentTokenPayload } from "@agent-paste/tokens/content";
import { BASELINE_SECURITY_HEADERS, getBoundResponders, writeArtifactEvent } from "@agent-paste/worker-runtime";
import type { AppContext, Env, R2ObjectBody } from "./env.js";
import { contentEtag, etagMatches } from "./etag.js";
import { frameAncestorsForEnv } from "./frame-ancestors.js";
import { injectViewerResizeReporter } from "./viewer-resize.js";

export const BUNDLE_FILENAME = "bundle.zip";
const securityHeaders = { ...BASELINE_SECURITY_HEADERS, ...CONTENT_SECURITY_HEADERS };
const NOINDEX_HEADER = "noindex, nofollow";

export function contentTokenFromRequest(context: AppContext): string {
  const pathname = new URL(context.req.raw.url).pathname;
  if (pathname.startsWith("/b/")) {
    const encodedToken = pathname.split("/")[2];
    return encodedToken ? (safeDecodeURIComponent(encodedToken) ?? "") : "";
  }
  return context.req.param("token") ?? "";
}

export function contentPath(context: AppContext): string {
  const pathname = new URL(context.req.raw.url).pathname;
  if (pathname.startsWith("/b/")) {
    return "";
  }
  const encodedToken = pathname.split("/")[2];
  if (!encodedToken) {
    return "";
  }
  const marker = `/v/${encodedToken}/`;
  return safeDecodeURIComponent(pathname.slice(marker.length)) ?? "";
}

export async function serveSignedBundle(context: AppContext, payload: ContentTokenPayload): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  const key = expectedBundleKeyForPayload(payload, env.AGENT_PASTE_ENV);
  if (!key || payload.key_prefix !== key) {
    return getBoundResponders(context).respondError("not_found");
  }

  const etag = await contentEtag(payload.revision_id, BUNDLE_FILENAME);
  if (etagMatches(request.headers.get("if-none-match"), etag)) {
    // Validate against the exact headers the 200 would carry so the 304 cannot
    // drift from them (RFC 9111 §4.3.4 lets a 304 replace the cached headers).
    return notModifiedResponse(context, payload, bundleResponseHeaders(0, payload.noindex === true, etag));
  }

  const object =
    request.method === "HEAD" && env.ARTIFACTS.head ? await env.ARTIFACTS.head(key) : await env.ARTIFACTS.get(key);
  if (!object) {
    return getBoundResponders(context).respondError("not_found");
  }

  const served = await prepareEncryptedObjectResponse({
    env,
    payload,
    object,
    path: BUNDLE_FILENAME,
    objectKey: key,
    method: request.method,
  });
  if (!served) {
    return getBoundResponders(context).respondError("not_found");
  }

  const headers = bundleResponseHeaders(served.plaintextSize, payload.noindex === true, etag);
  headers.set(REQUEST_ID_HEADER, getRequestId(context));

  return new Response(bodyFromBytes(served.bytes), { status: 200, headers });
}

export async function serveSignedObject(
  context: AppContext,
  payload: ContentTokenPayload,
  path: string,
): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;

  const key = objectKeyForPayload(payload, path);
  if (!key) {
    return getBoundResponders(context).respondError("not_found");
  }

  const etag = await contentEtag(payload.revision_id, path);
  // Only short-circuit when the 200 path would actually serve: a workspace-less
  // token 404s below (prepareEncryptedObjectResponse), so a conditional request
  // must 404 too, not return a 304 the client could never have a 200 for.
  if (payload.workspace_id && etagMatches(request.headers.get("if-none-match"), etag)) {
    // Validate against the exact headers the 200 would carry (per-path CSP
    // including the inline frame-ancestors relaxation, content-type,
    // cache-control) so the 304 cannot weaken them: RFC 9111 §4.3.4 lets a 304
    // replace the cached response's headers.
    return notModifiedResponse(
      context,
      payload,
      responseHeadersForPath(path, 0, payload, etag, frameAncestorsForEnv(env), request),
    );
  }

  const object =
    request.method === "HEAD" && env.ARTIFACTS.head ? await env.ARTIFACTS.head(key) : await env.ARTIFACTS.get(key);
  if (!object) {
    return getBoundResponders(context).respondError("not_found");
  }

  const served = await prepareEncryptedObjectResponse({
    env,
    payload,
    object,
    path,
    objectKey: key,
    method: request.method,
  });
  if (!served) {
    return getBoundResponders(context).respondError("not_found");
  }

  const injectsNoindex = payload.noindex === true && isHtmlPath(path);
  const trustedViewerFrame = isTrustedViewerFrameRequest(request, frameAncestorsForEnv(env));
  const scriptDisabled = payload.script_disabled !== false || (isHtmlPath(path) && !trustedViewerFrame);
  const injectsResizeReporter = isHtmlPath(path) && trustedViewerFrame && !scriptDisabled;
  const bytes =
    served.bytes && (injectsNoindex || injectsResizeReporter)
      ? transformViewerHtmlBytes(served.bytes, { noindex: injectsNoindex, resizeReporter: injectsResizeReporter })
      : served.bytes;
  const size = bytes ? bytes.byteLength : served.plaintextSize;

  const headers = responseHeadersForPath(path, size, payload, etag, frameAncestorsForEnv(env), request);
  // A HEAD has no body to measure, so it reports the arithmetic plaintext size.
  // When HTML injection would grow the GET body, that size is wrong, so drop
  // content-length rather than advertise a length the GET would not match.
  if (!bytes && (injectsNoindex || injectsResizeReporter)) {
    headers.delete("content-length");
  }
  headers.set(REQUEST_ID_HEADER, getRequestId(context));

  return new Response(bodyFromBytes(bytes), { status: 200, headers });
}

/**
 * Decrypted plaintext is the single source of truth for a GET response: `bytes`
 * carries the actual payload and its length. HEAD has no body, so it reports the
 * arithmetic `plaintextSize` derived from the stored ciphertext size instead
 * (and drops the header entirely when noindex injection would grow the GET body).
 */
type ServedObject = { bytes: Uint8Array | null; plaintextSize: number };

function bodyFromBytes(bytes: Uint8Array | null): ReadableStream | null {
  return bytes ? new Blob([bytes as BlobPart]).stream() : null;
}

async function prepareEncryptedObjectResponse(input: {
  env: Env;
  payload: ContentTokenPayload;
  object: R2ObjectBody;
  path: string;
  objectKey: string;
  method: string;
}): Promise<ServedObject | null> {
  const encryptionRing = artifactBytesEncryptionRingFromEnv(input.env);
  if (!encryptionRing || !isArtifactBytesEncryptionMetadata(input.object.customMetadata)) {
    return null;
  }
  const workspaceId = input.payload.workspace_id;
  if (!workspaceId) {
    return null;
  }
  const normalizedPath = input.path.length > 0 ? input.path : BUNDLE_FILENAME;
  const keyParts = normalizedPath === BUNDLE_FILENAME ? null : parseRevisionFileObjectKey(input.objectKey);
  const blobKeyParts = normalizedPath === BUNDLE_FILENAME ? null : parseWorkspaceBlobObjectKey(input.objectKey);
  const artifactId = keyParts?.artifactId ?? input.payload.artifact_id;
  const revisionId = keyParts?.revisionId ?? input.payload.revision_id;
  const emitRead = (bytes: number) =>
    writeArtifactEvent(input.env.ARTIFACT_EVENTS, {
      kind: "read",
      workspaceId,
      artifactId,
      revisionId,
      bytes,
      detail: input.method === "HEAD" ? "head" : "get",
    });
  if (input.method === "HEAD") {
    let plaintextSize: number;
    try {
      plaintextSize = plaintextByteLengthFromStoredObject(input.object.size);
    } catch {
      return null;
    }
    emitRead(plaintextSize);
    return { bytes: null, plaintextSize };
  }
  const ciphertext = await bytesFromReadableBody(input.object.body);
  try {
    const decryptContext =
      blobKeyParts && blobKeyParts.workspaceId === workspaceId
        ? { kind: "blob" as const, workspaceId, sha256: blobKeyParts.sha256 }
        : {
            workspaceId,
            artifactId,
            revisionId,
            normalizedPath,
          };
    const plaintext = await decryptArtifactBytesWithKeyRing({
      ciphertext,
      ring: encryptionRing,
      metadata: input.object.customMetadata,
      context: decryptContext,
    });
    emitRead(plaintext.byteLength);
    return { bytes: plaintext, plaintextSize: plaintext.byteLength };
  } catch {
    return null;
  }
}

export function denylistKeysForPayload(payload: ContentTokenPayload): string[] {
  return [
    ...(payload.workspace_id ? [`wsd:${payload.workspace_id}`] : []),
    `ad:${payload.artifact_id}`,
    `rd:${payload.revision_id}`,
    ...(payload.access_link_id ? [`ald:${payload.access_link_id}`] : []),
  ];
}

export async function isDenylisted(env: Env, payload: ContentTokenPayload): Promise<boolean> {
  const denylistResults = await Promise.all(denylistKeysForPayload(payload).map((key) => env.DENYLIST.get(key)));
  return denylistResults.some((value) => value !== null);
}

export function isAllowedPath(path: string, payload: ContentTokenPayload, storageEnv?: string): boolean {
  if (path.length === 0) {
    const expectedBundleKey = expectedBundleKeyForPayload(payload, storageEnv);
    return Boolean(expectedBundleKey && payload.key_prefix === expectedBundleKey);
  }
  if (!isSafePath(path) || !isAllowedFileKeyPrefix(payload)) {
    return false;
  }

  return !payload.paths || payload.paths.includes(path);
}

export function isSafePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function objectKeyFor(payload: ContentTokenPayload, path: string): string {
  const key = objectKeyForPayload(payload, path);
  if (!key) {
    throw new Error("invalid_key_prefix");
  }
  return key;
}

function objectKeyForPayload(payload: ContentTokenPayload, path: string): string | null {
  const mappedObjectKey = payload.object_keys?.[path];
  if (mappedObjectKey) {
    return isAllowedObjectKey(payload, path, mappedObjectKey) ? mappedObjectKey : null;
  }
  if (payload.object_key) {
    if (payload.paths?.length !== 1) {
      return null;
    }
    return isAllowedObjectKey(payload, path, payload.object_key) ? payload.object_key : null;
  }
  const prefix = fileKeyPrefixForPayload(payload);
  if (!prefix) {
    return null;
  }
  return `${prefix.replace(/\/+$/, "")}/${path}`;
}

function isAllowedObjectKey(payload: ContentTokenPayload, path: string, objectKey: string): boolean {
  if (!isSafePath(path) || !payload.paths?.includes(path) || !isSafeKeyPrefix(objectKey)) {
    return false;
  }
  const revisionKey = parseRevisionFileObjectKey(objectKey);
  if (revisionKey) {
    return (
      revisionKey.artifactId === payload.artifact_id &&
      revisionKey.revisionId === payload.revision_id &&
      revisionKey.path === path
    );
  }
  const blobKey = parseWorkspaceBlobObjectKey(objectKey);
  return Boolean(blobKey && payload.workspace_id && blobKey.workspaceId === payload.workspace_id);
}

function fileKeyPrefixForPayload(payload: ContentTokenPayload): string | null {
  const expected = defaultFileKeyPrefix(payload);
  if (!payload.key_prefix) {
    return expected;
  }
  return payload.key_prefix === expected && isSafeKeyPrefix(payload.key_prefix) ? payload.key_prefix : null;
}

function isAllowedFileKeyPrefix(payload: ContentTokenPayload): boolean {
  return fileKeyPrefixForPayload(payload) !== null;
}

function defaultFileKeyPrefix(payload: ContentTokenPayload): string {
  return `artifacts/${payload.artifact_id}/revisions/${payload.revision_id}/files`;
}

function expectedBundleKeyForPayload(payload: ContentTokenPayload, storageEnv?: string): string | null {
  if (!payload.workspace_id) {
    return null;
  }
  const key = bundleKeyFor({
    workspaceId: payload.workspace_id,
    artifactId: payload.artifact_id,
    revisionId: payload.revision_id,
    storageEnv,
  });
  return isSafeKeyPrefix(key) ? key : null;
}

function bundleKeyFor(input: {
  workspaceId: string;
  artifactId: string;
  revisionId: string;
  storageEnv?: string | undefined;
}): string {
  const env = storageEnvSegment(input.storageEnv);
  return `env/${env}/workspaces/${input.workspaceId}/artifacts/${input.artifactId}/revisions/${input.revisionId}/bundle.zip`;
}

function storageEnvSegment(agentPasteEnv?: string): string {
  if (agentPasteEnv === "production" || agentPasteEnv === "live") {
    return "live";
  }
  if (agentPasteEnv === "preview") {
    return "preview";
  }
  return "dev";
}

function isSafeKeyPrefix(keyPrefix: string): boolean {
  // R2 object keys are opaque strings; rejecting path-like traversal keeps that
  // assumption load-bearing if storage is ever adapted elsewhere.
  return !keyPrefix.startsWith("/") && !keyPrefix.includes("\\") && keyPrefix.split("/").every(isSafeKeySegment);
}

function isSafeKeySegment(segment: string): boolean {
  return segment !== "" && segment !== "." && segment !== "..";
}

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
  frameAncestors: readonly string[] = [],
  request?: Request,
): Headers {
  const trustedViewerFrame = isTrustedViewerFrameRequest(request, frameAncestors);
  const scriptDisabled = payload.script_disabled !== false || (isHtmlPath(path) && !trustedViewerFrame);
  const served = servedContentForPath(path, { scriptDisabled });
  const headers = new Headers(securityHeaders);
  headers.set("cache-control", CONTENT_CACHE_CONTROL);
  headers.set("etag", etag);
  headers.set("content-length", String(size));
  headers.set("content-type", served.contentType);
  // Inline content is rendered in the trusted viewer's sandboxed iframe; let the
  // app origin frame it via CSP and drop the origin-blind XFO that would re-block
  // it. Attachments are downloads and stay frame-denied.
  if (served.disposition === "inline" && trustedViewerFrame) {
    headers.set("content-security-policy", withFrameAncestors(served.csp, frameAncestors));
    headers.delete("x-frame-options");
  } else {
    headers.set("content-security-policy", served.csp);
  }
  if (served.disposition === "attachment") {
    headers.set("content-disposition", `attachment; filename="${attachmentFilename(path)}"`);
  }
  if (payload.noindex === true) {
    headers.set("x-robots-tag", NOINDEX_HEADER);
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

export function isTrustedViewerFrameRequest(request: Request | undefined, frameAncestors: readonly string[]): boolean {
  if (!request || frameAncestors.length === 0) {
    return false;
  }
  const destination = request.headers.get("sec-fetch-dest")?.toLowerCase();
  if (destination !== "iframe" && destination !== "frame") {
    return false;
  }
  const mode = request.headers.get("sec-fetch-mode")?.toLowerCase();
  if (mode && mode !== "navigate") {
    return false;
  }
  const site = request.headers.get("sec-fetch-site")?.toLowerCase();
  return !site || site === "same-site" || site === "same-origin";
}

// Every served file and bundle revalidates on every load (`no-cache`): paired
// with the strong ETag, an unchanged reload is a zero-body 304 instead of a full
// re-download, while denylist and expiry are still re-checked each time so a
// revoked or expired artifact stops serving immediately rather than lingering in
// a warm browser cache. `private` always: the URL is a bearer cap and must never
// enter a shared cache. The validator does the caching work; we deliberately do
// not grant a no-revalidation `max-age` window.
export const CONTENT_CACHE_CONTROL = "private, no-cache";

// 304 serves no bytes, but the request already counted against the artifact read
// limit, so it still registers a read (bytes: 0). It reuses the exact headers the
// 200 would carry (built by the caller) minus the now-meaningless content-length,
// so the validated cache entry keeps the same CSP, content-type, and cache
// directives instead of inheriting a weaker set from a hand-maintained 304 list.
function notModifiedResponse(context: AppContext, payload: ContentTokenPayload, headers: Headers): Response {
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
  headers.set(REQUEST_ID_HEADER, getRequestId(context));
  return new Response(null, { status: 304, headers });
}

function transformViewerHtmlBytes(
  bytes: Uint8Array,
  options: { noindex: boolean; resizeReporter: boolean },
): Uint8Array {
  let html = new TextDecoder().decode(bytes);
  if (options.noindex) {
    html = injectNoindexMeta(html);
  }
  if (options.resizeReporter) {
    html = injectViewerResizeReporter(html);
  }
  return new TextEncoder().encode(html);
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

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
