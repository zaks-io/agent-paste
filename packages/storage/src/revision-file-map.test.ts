import { createHash } from "node:crypto";
import { CHUNK_BYTES } from "@agent-paste/config";
import { describe, expect, it } from "vitest";
import { workspaceBlobObjectKeyFor } from "./artifact-bytes-encryption.js";
import {
  lookupFileMapEntry,
  parseRevisionFileMap,
  type RevisionFileMapV1,
  serializeRevisionFileMap,
} from "./revision-file-map.js";

const identity = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  artifactId: "art_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  revisionId: "rev_01ARZ3NDEKTSV4RRFFQ69G5FAV",
};
const sha = "a".repeat(64);
const map: RevisionFileMapV1 = {
  version: 1,
  workspace_id: identity.workspaceId,
  artifact_id: identity.artifactId,
  revision_id: identity.revisionId,
  entrypoint: "index.html",
  files: [
    {
      path: "asset.bin",
      size_bytes: CHUNK_BYTES * 3,
      sha256: sha,
      content_type: "application/octet-stream",
      format: "chunked-v1",
      chunk_bytes: CHUNK_BYTES,
      chunks: [sha, sha, sha],
    },
    {
      path: "index.html",
      size_bytes: 3,
      sha256: sha,
      content_type: "text/html",
      format: "single",
      object_key: workspaceBlobObjectKeyFor({ workspaceId: identity.workspaceId, sha256: sha }),
    },
  ],
};
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("Revision file maps", () => {
  it("round trips both formats with deterministic JSON key order and a stable digest", () => {
    const bytes = serializeRevisionFileMap(map);
    expect(parseRevisionFileMap(bytes, identity)).toEqual(map);
    const reordered = {
      files: map.files.map((file) => Object.fromEntries(Object.entries(file).reverse())),
      entrypoint: map.entrypoint,
      revision_id: map.revision_id,
      artifact_id: map.artifact_id,
      workspace_id: map.workspace_id,
      version: 1,
    };
    const parsed = parseRevisionFileMap(encode(reordered), identity);
    expect(serializeRevisionFileMap(parsed)).toEqual(bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      createHash("sha256").update(JSON.stringify(map)).digest("hex"),
    );
  });
  it("looks up a sorted tree including missing paths", () => {
    expect(lookupFileMapEntry(map, "asset.bin")).toEqual(map.files[0]);
    expect(lookupFileMapEntry(map, "index.html")).toEqual(map.files[1]);
    for (const path of ["", "h", "z"]) expect(lookupFileMapEntry(map, path)).toBeNull();
  });
  it("accepts only the exact Revision and path for legacy keys", () => {
    const file = {
      ...map.files[1],
      object_key: `artifacts/${identity.artifactId}/revisions/${identity.revisionId}/files/index.html`,
      sha256: null,
    };
    expect(parseRevisionFileMap(encode({ ...map, files: [file] }), identity).files[0]).toMatchObject({ sha256: null });
    for (const key of [
      file.object_key.replace("index.html", "secret.txt"),
      file.object_key.replace(identity.revisionId, "rev_other"),
      `workspaces/foreign/blobs/sha256/aa/${sha}`,
    ])
      expect(() => parseRevisionFileMap(encode({ ...map, files: [{ ...file, object_key: key }] }), identity)).toThrow();
  });
  it("rejects identity, geometry, unsafe paths, sort order, and schema violations", () => {
    const invalid = [
      { ...map, version: 2 },
      { ...map, workspace_id: "other" },
      { ...map, artifact_id: "art_other" },
      { ...map, revision_id: "rev_other" },
      { ...map, entrypoint: "missing" },
      { ...map, extra: true },
      { ...map, files: [] },
      { ...map, files: [...map.files].reverse() },
      { ...map, files: [map.files[1], map.files[1]] },
      { ...map, files: [{ ...map.files[0], path: "../secret" }, map.files[1]] },
      { ...map, files: [{ ...map.files[0], chunk_bytes: CHUNK_BYTES + 1 }, map.files[1]] },
      { ...map, files: [{ ...map.files[0], chunks: [sha] }, map.files[1]] },
      { ...map, files: [{ ...map.files[0], chunks: [sha.toUpperCase(), sha, sha] }, map.files[1]] },
      { ...map, files: [{ ...map.files[0], sha256: null }, map.files[1]] },
      { ...map, files: [{ ...map.files[0], size_bytes: -1 }, map.files[1]] },
      { ...map, files: [{ ...map.files[0], content_type: "text/plain\r\nx-evil: yes" }, map.files[1]] },
      { ...map, files: [{ ...map.files[0], object_key: "extra" }, map.files[1]] },
      { ...map, files: [map.files[0], { ...map.files[1], sha256: "b".repeat(64) }] },
    ];
    for (const value of invalid) expect(() => parseRevisionFileMap(encode(value), identity)).toThrow();
    expect(() => parseRevisionFileMap(Uint8Array.of(255), identity)).toThrow();
    expect(() => parseRevisionFileMap(new Uint8Array(8 * 1024 * 1024 + 1), identity)).toThrow();
    expect(() => serializeRevisionFileMap({ ...map, files: [...map.files].reverse() })).toThrow();
  });
});
