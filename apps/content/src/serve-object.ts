import { getRequestId, REQUEST_ID_HEADER } from "@agent-paste/auth";
import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import {
  attachmentFilename,
  bytesFromReadableBody,
  CONTENT_SECURITY_HEADERS,
  decryptArtifactBytesWithKeyRing,
  isArtifactBytesEncryptionMetadata,
  parseRevisionFileObjectKey,
  plaintextByteLengthFromStoredObject,
  servedContentForPath,
} from "@agent-paste/storage";
import type { ContentTokenPayload } from "@agent-paste/tokens/content";
import { BASELINE_SECURITY_HEADERS, getBoundResponders, writeArtifactEvent } from "@agent-paste/worker-runtime";
import type { AppContext, Env, R2ObjectBody } from "./env.js";

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
  const key = payload.key_prefix;
  if (!key?.endsWith(BUNDLE_FILENAME)) {
    return getBoundResponders(context).respondError("not_found");
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

  const headers = bundleResponseHeaders(served.plaintextSize, payload.exp, payload.noindex === true);
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

  const key = objectKeyFor(payload, path);
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
  const bytes = served.bytes && injectsNoindex ? injectNoindexMetaBytes(served.bytes) : served.bytes;
  const size = bytes ? bytes.byteLength : served.plaintextSize;

  const headers = responseHeadersForPath(path, size, payload.exp, payload);
  // A HEAD has no body to measure, so it reports the arithmetic plaintext size.
  // When noindex injection would grow the GET body, that size is wrong, so drop
  // content-length rather than advertise a length the GET would not match.
  if (!bytes && injectsNoindex) {
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
    const plaintext = await decryptArtifactBytesWithKeyRing({
      ciphertext,
      ring: encryptionRing,
      metadata: input.object.customMetadata,
      context: {
        workspaceId,
        artifactId,
        revisionId,
        normalizedPath,
      },
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

export function isAllowedPath(path: string, payload: ContentTokenPayload): boolean {
  if (path.length === 0) {
    return Boolean(payload.key_prefix?.endsWith(BUNDLE_FILENAME));
  }
  if (!isSafePath(path)) {
    return false;
  }

  return !payload.paths || payload.paths.includes(path);
}

export function isSafePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.split("/").includes("..");
}

export function objectKeyFor(payload: ContentTokenPayload, path: string): string {
  const prefix = payload.key_prefix ?? `artifacts/${payload.artifact_id}/revisions/${payload.revision_id}/files`;
  return `${prefix.replace(/\/+$/, "")}/${path}`;
}

export function bundleResponseHeaders(size: number, tokenExpiresAt: number, noindex: boolean): Headers {
  const headers = new Headers(securityHeaders);
  headers.set("cache-control", `private, max-age=${Math.max(0, tokenExpiresAt - Math.floor(Date.now() / 1000))}`);
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
  tokenExpiresAt: number,
  payload: ContentTokenPayload,
): Headers {
  const scriptDisabled = payload.script_disabled !== false;
  const served = servedContentForPath(path, { scriptDisabled });
  const headers = new Headers(securityHeaders);
  headers.set("cache-control", `private, max-age=${Math.max(0, tokenExpiresAt - Math.floor(Date.now() / 1000))}`);
  headers.set("content-length", String(size));
  headers.set("content-type", served.contentType);
  headers.set("content-security-policy", served.csp);
  if (served.disposition === "attachment") {
    headers.set("content-disposition", `attachment; filename="${attachmentFilename(path)}"`);
  }
  if (payload.noindex === true) {
    headers.set("x-robots-tag", NOINDEX_HEADER);
  }
  return headers;
}

function injectNoindexMetaBytes(bytes: Uint8Array): Uint8Array {
  const html = new TextDecoder().decode(bytes);
  return new TextEncoder().encode(injectNoindexMeta(html));
}

export function isHtmlPath(path: string): boolean {
  return /\.(?:html?|xhtml)$/i.test(path);
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

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
