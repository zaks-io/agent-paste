import {
  CHUNK_BYTES,
  MAX_FILE_BYTES,
  MAX_FILE_MAP_BYTES,
  MAX_REVISION_BYTES,
  MAX_REVISION_FILES,
} from "@agent-paste/config";
import { chunkCount } from "@agent-paste/contracts/file-transfer";
import { ArtifactId, FilePath, RevisionId, WorkspaceId } from "@agent-paste/contracts/primitives";
import { parseRevisionFileObjectKey, parseWorkspaceBlobObjectKey } from "./artifact-bytes-encryption.js";

export type RevisionFileMapEntry =
  | {
      path: string;
      size_bytes: number;
      sha256: string | null;
      content_type: string;
      format: "single";
      object_key: string;
    }
  | {
      path: string;
      size_bytes: number;
      sha256: string;
      content_type: string;
      format: "chunked-v1";
      chunk_bytes: number;
      chunks: string[];
    };
export type RevisionFileMapV1 = {
  version: 1;
  workspace_id: string;
  artifact_id: string;
  revision_id: string;
  entrypoint: string;
  files: RevisionFileMapEntry[];
};
type ExpectedIdentity = { workspaceId: string; artifactId: string; revisionId: string };
const shaPattern = /^[a-f0-9]{64}$/u;

function invalid(): never {
  throw new Error("invalid_revision_file_map");
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) invalid();
}
function validSha(value: unknown): value is string {
  return typeof value === "string" && shaPattern.test(value);
}
function path(value: unknown): string {
  const parsed = FilePath.safeParse(value);
  if (!parsed.success) invalid();
  return parsed.data;
}

function validateMap(value: unknown, expect: ExpectedIdentity): RevisionFileMapV1 {
  const map = record(value);
  onlyKeys(map, ["version", "workspace_id", "artifact_id", "revision_id", "entrypoint", "files"]);
  if (
    map.version !== 1 ||
    !WorkspaceId.safeParse(map.workspace_id).success ||
    !ArtifactId.safeParse(map.artifact_id).success ||
    !RevisionId.safeParse(map.revision_id).success ||
    map.workspace_id !== expect.workspaceId ||
    map.artifact_id !== expect.artifactId ||
    map.revision_id !== expect.revisionId ||
    !Array.isArray(map.files) ||
    map.files.length < 1 ||
    map.files.length > MAX_REVISION_FILES
  )
    invalid();
  const entrypoint = path(map.entrypoint);
  let previous: string | undefined;
  let total = 0;
  const files = map.files.map((value): RevisionFileMapEntry => {
    const file = record(value);
    const filePath = path(file.path);
    if (previous !== undefined && previous >= filePath) invalid();
    previous = filePath;
    if (
      typeof file.size_bytes !== "number" ||
      !Number.isSafeInteger(file.size_bytes) ||
      file.size_bytes < 0 ||
      file.size_bytes > MAX_FILE_BYTES ||
      typeof file.content_type !== "string" ||
      file.content_type.length < 1 ||
      file.content_type.length > 200 ||
      /[\r\n\0]/u.test(file.content_type)
    )
      invalid();
    total += file.size_bytes;
    if (total > MAX_REVISION_BYTES) invalid();
    const common = { path: filePath, size_bytes: file.size_bytes, content_type: file.content_type };
    if (file.format === "single") {
      onlyKeys(file, ["path", "size_bytes", "sha256", "content_type", "format", "object_key"]);
      if ((file.sha256 !== null && !validSha(file.sha256)) || typeof file.object_key !== "string") invalid();
      const blob = parseWorkspaceBlobObjectKey(file.object_key);
      const revision = parseRevisionFileObjectKey(file.object_key);
      if (
        !(blob?.workspaceId === expect.workspaceId && blob.sha256 === file.sha256) &&
        !(
          revision?.artifactId === expect.artifactId &&
          revision.revisionId === expect.revisionId &&
          revision.path === filePath
        )
      )
        invalid();
      return { ...common, sha256: file.sha256, format: "single", object_key: file.object_key };
    }
    if (file.format !== "chunked-v1") invalid();
    onlyKeys(file, ["path", "size_bytes", "sha256", "content_type", "format", "chunk_bytes", "chunks"]);
    if (
      !validSha(file.sha256) ||
      file.chunk_bytes !== CHUNK_BYTES ||
      !Array.isArray(file.chunks) ||
      file.size_bytes === 0 ||
      file.chunks.length !== chunkCount(file.size_bytes) ||
      !file.chunks.every(validSha)
    )
      invalid();
    return { ...common, sha256: file.sha256, format: "chunked-v1", chunk_bytes: CHUNK_BYTES, chunks: file.chunks };
  });
  if (!files.some((file) => file.path === entrypoint)) invalid();
  return {
    version: 1,
    workspace_id: expect.workspaceId,
    artifact_id: expect.artifactId,
    revision_id: expect.revisionId,
    entrypoint,
    files,
  };
}

export function serializeRevisionFileMap(map: RevisionFileMapV1): Uint8Array {
  const validated = validateMap(map, {
    workspaceId: map.workspace_id,
    artifactId: map.artifact_id,
    revisionId: map.revision_id,
  });
  // Explicit key order makes digests independent of caller insertion order.
  const files = validated.files.map((file) =>
    file.format === "single"
      ? {
          path: file.path,
          size_bytes: file.size_bytes,
          sha256: file.sha256,
          content_type: file.content_type,
          format: file.format,
          object_key: file.object_key,
        }
      : {
          path: file.path,
          size_bytes: file.size_bytes,
          sha256: file.sha256,
          content_type: file.content_type,
          format: file.format,
          chunk_bytes: file.chunk_bytes,
          chunks: file.chunks,
        },
  );
  const bytes = new TextEncoder().encode(JSON.stringify({ ...validated, files }));
  if (bytes.byteLength > MAX_FILE_MAP_BYTES) invalid();
  return bytes;
}

export function parseRevisionFileMap(bytes: Uint8Array, expect: ExpectedIdentity): RevisionFileMapV1 {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_MAP_BYTES) invalid();
  return validateMap(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)), expect);
}

export function lookupFileMapEntry(map: RevisionFileMapV1, path: string): RevisionFileMapEntry | null {
  let low = 0;
  let high = map.files.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const file = map.files[mid];
    if (!file) return null;
    if (file.path === path) return file;
    if (file.path < path) low = mid + 1;
    else high = mid - 1;
  }
  return null;
}
