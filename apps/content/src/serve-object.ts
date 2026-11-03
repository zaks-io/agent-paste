import { getRequestId, REQUEST_ID_HEADER } from "@agent-paste/auth";
import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import {
  bytesFromReadableBodyCapped,
  ciphertextByteLengthForPlaintext,
  decryptArtifactBytesWithKeyRing,
  isArtifactBytesEncryptionMetadata,
  parseRevisionFileObjectKey,
  parseWorkspaceBlobObjectKey,
  plaintextByteLengthFromStoredObject,
  readStoredFilePrefix,
} from "@agent-paste/storage";
import type { ContentTokenPayload } from "@agent-paste/tokens/content";
import { getBoundResponders, writeArtifactEvent } from "@agent-paste/worker-runtime";
import { gzipBytes, negotiatesGzip } from "./content-encoding.js";
import { measureStream } from "./content-stream.js";
import type { AppContext, Env, R2ObjectBody } from "./env.js";
import { contentEtag, etagMatches } from "./etag.js";
import { applyRangeHeaders, requestedRange } from "./range.js";
import {
  BUNDLE_FILENAME,
  bundleResponseHeaders,
  contentRepresentationKey,
  isHtmlPath,
  notModifiedResponse,
  responseHeadersForPath,
  transformHtmlBytes,
} from "./response-headers.js";
import { serveMappedFile } from "./serve-mapped-file.js";

export {
  BUNDLE_FILENAME,
  bundleResponseHeaders,
  contentRepresentationKey,
  injectNoindexMeta,
  isHtmlPath,
  responseHeadersForPath,
} from "./response-headers.js";

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

  return new Response(measuredBody(context, payload, served.bytes), { status: 200, headers });
}

export async function serveSignedObject(
  context: AppContext,
  payload: ContentTokenPayload,
  path: string,
): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;

  if (payload.file_map) return serveMappedFile(context, payload, path);
  const key = objectKeyForPayload(payload, path);
  if (!key) {
    return getBoundResponders(context).respondError("not_found");
  }

  const gzip = payload.original_bytes !== true && negotiatesGzip(path, request);
  const representationKey = contentRepresentationKey(path, payload, gzip);
  // Legacy tokens lack a signed size, so retain their revision validator.
  const etag = await contentEtag(payload.revision_id, path, representationKey);
  // Only short-circuit when the 200 path would actually serve: a workspace-less
  // token 404s below (prepareEncryptedObjectResponse), so a conditional request
  // must 404 too, not return a 304 the client could never have a 200 for.
  if (payload.workspace_id && etagMatches(request.headers.get("if-none-match"), etag)) {
    // Validate against the exact headers the 200 would carry (per-path CSP,
    // content-type, and cache-control) so the 304 cannot weaken them: RFC 9111 §4.3.4 lets a 304
    // replace the cached response's headers.
    return notModifiedResponse(context, payload, responseHeadersForPath(path, 0, payload, etag, request));
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

  const injectsNoindex = payload.original_bytes !== true && payload.noindex === true && isHtmlPath(path);
  const transformed =
    served.bytes && injectsNoindex ? transformHtmlBytes(served.bytes, { noindex: injectsNoindex }) : served.bytes;
  const bytes = transformed && gzip ? await gzipBytes(transformed) : transformed;
  const size = bytes ? bytes.byteLength : served.plaintextSize;

  const headers = responseHeadersForPath(path, size, payload, etag, request);
  // A HEAD has no body to measure, so it reports the arithmetic plaintext size.
  // When HTML injection or gzip would change the GET body length, that size is
  // wrong, so drop content-length rather than advertise a length the GET would
  // not match.
  if (!bytes && (injectsNoindex || gzip)) {
    headers.delete("content-length");
  }
  headers.set(REQUEST_ID_HEADER, getRequestId(context));

  // The body is already in its final coding; "automatic" would make the Workers
  // runtime gzip it a second time because content-encoding is set.
  const range = !gzip && !injectsNoindex ? requestedRange(request, size, etag) : null;
  const status = !gzip && !injectsNoindex ? applyRangeHeaders(headers, range, size) : 200;
  const selected =
    range === "unsatisfiable" ? null : bytes && range ? bytes.subarray(range.start, range.endInclusive + 1) : bytes;
  return new Response(measuredBody(context, payload, selected), { status, headers, encodeBody: "manual" });
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

function measuredBody(
  context: AppContext,
  payload: ContentTokenPayload,
  bytes: Uint8Array | null,
): ReadableStream | null {
  const emit = (size: number) => {
    if (!payload.workspace_id) return;
    writeArtifactEvent(context.env.ARTIFACT_EVENTS, {
      kind: "read",
      workspaceId: payload.workspace_id,
      artifactId: payload.artifact_id,
      revisionId: payload.revision_id,
      bytes: size,
      detail: context.req.raw.method === "HEAD" ? "head" : "get",
    });
  };
  const body = bodyFromBytes(bytes);
  if (!body) {
    emit(0);
    return null;
  }
  return measureStream(body, emit);
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
  const bundle = input.objectKey === expectedBundleKeyForPayload(input.payload, input.env.AGENT_PASTE_ENV);
  const cap = ciphertextByteLengthForPlaintext((bundle ? 100 : 25) * 1024 * 1024);
  if (!Number.isSafeInteger(input.object.size) || input.object.size > cap) {
    await input.object.body?.cancel().catch(() => undefined);
    return null;
  }
  try {
    const plaintextSize = plaintextByteLengthFromStoredObject(input.object.size);
    if (input.method === "HEAD") return { bytes: null, plaintextSize };
    if (!bundle) {
      const bytes = await readStoredFilePrefix(
        {
          r2: {
            async get() {
              return input.object;
            },
          },
          ring: encryptionRing,
          workspaceId,
          file: { format: "single", objectKey: input.objectKey, sizeBytes: plaintextSize },
        },
        plaintextSize,
      );
      return { bytes, plaintextSize };
    }
    const ciphertext = await bytesFromReadableBodyCapped(input.object.body, cap);
    if (ciphertext.length !== input.object.size) return null;
    const bytes = await decryptArtifactBytesWithKeyRing({
      ciphertext,
      ring: encryptionRing,
      metadata: input.object.customMetadata,
      context: {
        workspaceId,
        artifactId: input.payload.artifact_id,
        revisionId: input.payload.revision_id,
        normalizedPath: BUNDLE_FILENAME,
      },
    });
    return { bytes, plaintextSize };
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

  return Boolean(payload.file_map) || !payload.paths || payload.paths.includes(path);
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

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
