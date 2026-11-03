import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/index.js";

const aid = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const rid = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const uid = "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const date = "2026-12-01T00:00:00.000Z";
const retention = {
  artifact_id: aid,
  url: "https://site.test/",
  retention: "pinned",
  pinned_at: date,
  expires_at: date,
  effective_expires_at: null,
  pinned_count: 1,
  pin_allowance: 3,
};
function client(body: unknown) {
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(body));
  return {
    api: new ApiClient({
      auth: { type: "api_key", apiKey: "fixture" },
      apiBaseUrl: "https://api.test",
      uploadBaseUrl: "https://upload.test",
      fetch: fetchImpl,
    }),
    fetchImpl,
  };
}
describe("transfer route adapters", () => {
  it("forwards retention and storage routes with required idempotency keys", async () => {
    const { api, fetchImpl } = client(retention);
    expect(await api.artifacts.pin(aid, "key")).toEqual(retention);
    await api.artifacts.unpin(aid, "unpin");
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      `https://api.test/v1/artifacts/${aid}/pin`,
      `https://api.test/v1/artifacts/${aid}/unpin`,
    ]);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: "POST", headers: { "Idempotency-Key": "key" } });
  });
  it("pins file pages and read grants to a revision", async () => {
    const { api, fetchImpl } = client({
      artifact_id: aid,
      revision_id: rid,
      file_count: 0,
      size_bytes: 0,
      entrypoint: "index.html",
      title: "Site",
      items: [],
      page_info: { has_more: false, next_cursor: null },
    });
    await api.artifactFiles.list(aid, { revision_id: rid, prefix: "a b", cursor: "next", limit: 1000 });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(`revision_id=${rid}&prefix=a+b&cursor=next&limit=1000`);
    const grant = client({
      artifact_id: aid,
      revision_id: rid,
      content_base_url: "https://content.test/v/grant/",
      expires_at: date,
      file_count: 1,
      size_bytes: 3,
    });
    await grant.api.artifacts.readGrant(aid, rid);
    expect(grant.fetchImpl.mock.calls[0]?.[0]).toBe(
      `https://api.test/v1/artifacts/${aid}/read-grant?revision_id=${rid}`,
    );
  });
  it("uses the upload host for ordered batches, targets and completions", async () => {
    const { api, fetchImpl } = client({ upload_session_id: uid, sealed: true, next_batch_index: 2, files: [] });
    await api.uploadSessions.appendFiles(uid, { batch_index: 1, files: [], more_files: false }, "batch");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`https://upload.test/v1/upload-sessions/${uid}/file-batches`);
    const target = client({
      upload_session_id: uid,
      status: "pending",
      sealed: true,
      expires_at: date,
      remaining: { files: 0, chunks: 0, bytes: 0, unverified_files: 0 },
      targets: [],
      page_info: { has_more: false, next_cursor: null },
    });
    await target.api.uploadSessions.targets(uid, { cursor: "next", limit: 1000 });
    expect(target.fetchImpl.mock.calls[0]?.[0]).toBe(
      `https://upload.test/v1/upload-sessions/${uid}/targets?cursor=next&limit=1000`,
    );
    const completion = client({
      upload_session_id: uid,
      files: [{ path: "large.bin", status: "verified", sha256: "a".repeat(64), size_bytes: 11 * 1024 * 1024 }],
    });
    await completion.api.uploadSessions.completeFiles(uid, { paths: ["large.bin" as never] }, "complete");
    expect(completion.fetchImpl.mock.calls[0]).toMatchObject([
      `https://upload.test/v1/upload-sessions/${uid}/file-completions`,
      { method: "POST", body: JSON.stringify({ paths: ["large.bin"] }), headers: { "Idempotency-Key": "complete" } },
    ]);
  });
  it("keeps structured conflict details and quota retry semantics", async () => {
    const api = new ApiClient({
      auth: { type: "api_key", apiKey: "fixture" },
      fetch: async () =>
        Response.json(
          {
            error: {
              code: "commit_conflict",
              message: "changed",
              request_id: "request",
              details: { kind: "paths", head_revision_id: rid, conflicts: [{ path: "a" }] },
            },
          },
          { status: 409 },
        ),
    });
    await expect(api.artifacts.pin(aid, "key")).rejects.toMatchObject({
      code: "commit_conflict",
      status: 409,
      details: { kind: "paths", conflicts: [{ path: "a" }] },
    });
  });
  it("fetches streamed signed content without forwarding bearer credentials", async () => {
    const { api, fetchImpl } = client({});
    const response = await api.fetchContent("https://content.test/v/token/a", {
      Range: "bytes=4-",
      "If-Range": '"hash"',
    });
    expect(response).toBeInstanceOf(Response);
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual({
      headers: { "Accept-Encoding": "identity", Range: "bytes=4-", "If-Range": '"hash"' },
    });
  });
});
