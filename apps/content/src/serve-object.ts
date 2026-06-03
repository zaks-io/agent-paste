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
import { getBoundResponders } from "@agent-paste/worker-runtime";
import type { AppContext, Env, R2ObjectBody } from "./env.js";

export const BUNDLE_FILENAME = "bundle.zip";
const securityHeaders = CONTENT_SECURITY_HEADERS;
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

  return new Response(served.body, { status: 200, headers });
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

  const headers = responseHeadersForPath(path, served.plaintextSize, payload.exp, payload);
  headers.set(REQUEST_ID_HEADER, getRequestId(context));

  let body = served.body;
  if (payload.noindex === true && served.body && request.method !== "HEAD") {
    body = await maybeInjectNoindexMetaBody(served.body, path);
  }
  return new Response(body, { status: 200, headers });
}

async function prepareEncryptedObjectResponse(input: {
  env: Env;
  payload: ContentTokenPayload;
  object: R2ObjectBody;
  path: string;
  objectKey: string;
  method: string;
}): Promise<{ body: ReadableStream | null; plaintextSize: number } | null> {
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
  let plaintextSize: number;
  try {
    plaintextSize = plaintextByteLengthFromStoredObject(input.object.size);
  } catch {
    return null;
  }
  if (input.method === "HEAD") {
    return { body: null, plaintextSize };
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
    return {
      body: new Blob([plaintext as BlobPart]).stream(),
      plaintextSize,
    };
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

async function maybeInjectNoindexMetaBody(body: ReadableStream, path: string): Promise<ReadableStream> {
  if (!isHtmlPath(path)) {
    return body;
  }
  const html = await new Response(body).text();
  return new Blob([injectNoindexMeta(html)]).stream();
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
