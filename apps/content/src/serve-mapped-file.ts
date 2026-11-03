import { chunkSize } from "@agent-paste/contracts/file-transfer";
import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import { lookupFileMapEntry, readStoredFilePrefix, type StoredFileRef, streamStoredFile } from "@agent-paste/storage";
import type { ContentTokenPayload } from "@agent-paste/tokens/content";
import { getBoundResponders, writeArtifactEvent } from "@agent-paste/worker-runtime";
import { gzipBytes, negotiatesGzip } from "./content-encoding.js";
import { measureStream } from "./content-stream.js";
import type { AppContext } from "./env.js";
import { contentEtag, etagMatches } from "./etag.js";
import { resolveFileMap } from "./file-map.js";
import { applyRangeHeaders, requestedRange } from "./range.js";
import {
  contentRepresentationKey,
  isHtmlPath,
  notModifiedResponse,
  responseHeadersForPath,
  transformHtmlBytes,
} from "./response-headers.js";

export async function serveMappedFile(
  context: AppContext,
  payload: ContentTokenPayload,
  path: string,
): Promise<Response> {
  const map = await resolveFileMap(context.env, payload);
  const entry = map ? lookupFileMapEntry(map, path) : null;
  const ring = artifactBytesEncryptionRingFromEnv(context.env);
  if (!entry || !ring || !payload.workspace_id) return getBoundResponders(context).respondError("not_found");
  const request = context.req.raw;
  const chunked = entry.format === "chunked-v1";
  const gzip = payload.original_bytes !== true && !chunked && negotiatesGzip(path, request);
  const noindex = payload.original_bytes !== true && payload.noindex === true && isHtmlPath(path);
  const etag = await contentEtag(
    payload.revision_id,
    path,
    contentRepresentationKey(path, payload, gzip),
    entry.sha256 ? { sha256: entry.sha256, sizeBytes: entry.size_bytes } : undefined,
  );
  const headers = responseHeadersForPath(path, entry.size_bytes, payload, etag, request);
  if (chunked) headers.delete("content-encoding");
  if (etagMatches(request.headers.get("if-none-match"), etag)) return notModifiedResponse(context, payload, headers);
  const range = !gzip && !noindex ? requestedRange(request, entry.size_bytes, etag) : null;
  const status = !gzip && !noindex ? applyRangeHeaders(headers, range, entry.size_bytes) : 200;
  if (noindex || gzip) headers.delete("content-length");
  const emitRead = (bytes: number) =>
    writeArtifactEvent(context.env.ARTIFACT_EVENTS, {
      kind: "read",
      workspaceId: payload.workspace_id as string,
      artifactId: payload.artifact_id,
      revisionId: payload.revision_id,
      bytes,
      detail: request.method === "HEAD" ? "head" : "get",
    });
  if (request.method === "HEAD" || range === "unsatisfiable") {
    emitRead(0);
    return new Response(null, { status, headers });
  }
  const file: StoredFileRef =
    entry.format === "single"
      ? { format: "single", objectKey: entry.object_key, sizeBytes: entry.size_bytes }
      : {
          format: "chunked-v1",
          sizeBytes: entry.size_bytes,
          chunks: entry.chunks.map((sha256, index) => ({ sha256, sizeBytes: chunkSize(entry.size_bytes, index) })),
        };
  const input = { r2: context.env.ARTIFACTS, ring, workspaceId: payload.workspace_id, file };
  if (chunked) {
    const source = streamStoredFile({ ...input, ...(range ? { range } : {}) });
    return new Response(measureStream(source, emitRead, noindex), { status, headers, encodeBody: "manual" });
  }
  try {
    let bytes = await readStoredFilePrefix(input, file.sizeBytes);
    if (noindex) bytes = transformHtmlBytes(bytes, { noindex: true });
    if (gzip) bytes = await gzipBytes(bytes);
    if (range) bytes = bytes.subarray(range.start, range.endInclusive + 1);
    headers.set("content-length", String(bytes.length));
    return new Response(measureStream(new Blob([bytes as BlobPart]).stream(), emitRead), {
      status,
      headers,
      encodeBody: "manual",
    });
  } catch {
    return getBoundResponders(context).respondError("not_found");
  }
}
