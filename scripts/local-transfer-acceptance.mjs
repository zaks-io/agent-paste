import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ApiClient, executePublish, planPublish } from "../packages/api-client/dist/src/index.js";
import { forceExpireArtifact, provisionSmokeWorkspace } from "./smoke-harness.mjs";

const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const key = () => randomUUID();
function transport(api) {
  return {
    createUploadSession: api.uploadSessions.create,
    appendFiles: api.uploadSessions.appendFiles,
    targets: api.uploadSessions.targets,
    completeFiles: api.uploadSessions.completeFiles,
    listFiles: api.artifactFiles.list,
    getAgentView: (id, rev) => (rev ? api.artifacts.getRevisionAgentView(id, rev) : api.artifacts.getAgentView(id)),
    putFile: (url, bytes, headers) => api.putFile(url, bytes, headers),
    finalize: api.uploadSessions.finalize,
    publishRevision: api.revisions.publish,
  };
}
export async function localTransferAcceptance({ localHarness, urls, provisioned }) {
  const checks = [];
  const client = (credential) =>
    new ApiClient({ apiBaseUrl: urls.api, uploadBaseUrl: urls.upload, auth: { type: "api_key", apiKey: credential } });
  const api = client(provisioned.api_key.secret);
  const t = transport(api);
  const source = (name, text) => {
    const bytes = new TextEncoder().encode(text);
    return {
      path: name,
      sizeBytes: bytes.length,
      sha256: hash(bytes),
      contentType: name.endsWith(".css") ? "text/css; charset=utf-8" : "text/plain; charset=utf-8",
      readRange: async (start, n) => bytes.slice(start, start + n),
    };
  };
  const publish = async (sources, extra = {}) => {
    const input = {
      sources,
      title: "Local acceptance",
      entrypoint: "index.txt",
      mode: { kind: "tree" },
      idempotencyKey: key(),
      ...extra,
    };
    return (await executePublish(t, await planPublish(t, input), input)).result;
  };
  const initialSources = [source("index.txt", "original bytes"), source("asset.css", "cache proof")];
  const published = await publish(initialSources, { pin: true });
  assert.equal(published.retention, "pinned");
  const revisionCount = (await api.revisions.list(published.artifact_id)).items.length;
  const noOpInput = {
    sources: initialSources,
    title: published.title,
    entrypoint: "index.txt",
    mode: { kind: "tree" },
    pin: true,
    artifactId: published.artifact_id,
    idempotencyKey: key(),
  };
  const noOp = await executePublish(t, await planPublish(t, noOpInput), noOpInput);
  assert.equal(noOp.noChange, true);
  assert.equal(noOp.uploadStats.uploadedBytes, 0);
  assert.equal((await api.revisions.list(published.artifact_id)).items.length, revisionCount);
  checks.push("Unchanged publish sends zero bytes and leaves the HTTP revision count unchanged");
  const before = await fetch(new URL("asset.css", published.url));
  assert.equal(before.status, 200);
  assert.equal(await before.text(), "cache proof");
  const etag = before.headers.get("etag");
  assert(etag);
  assert.match(before.headers.get("cache-control"), /max-age=3600/);
  await forceExpireArtifact(urls.api, published.artifact_id);
  const expired = localHarness.services.repo.artifacts.get(published.artifact_id);
  assert(Date.parse(expired.expires_at) < Date.now());
  const stillServed = await fetch(published.url);
  assert.equal(stillServed.status, 200);
  assert.equal(await stillServed.text(), "original bytes");
  const unpinned = await api.artifacts.unpin(published.artifact_id, key());
  const policy = await api.usagePolicy();
  assert(Math.abs(Date.parse(unpinned.effective_expires_at) - Date.now() - policy.default_ttl_seconds * 1000) < 5000);
  const pinned = await api.artifacts.pin(published.artifact_id, key());
  assert.equal(pinned.effective_expires_at, null);
  assert.equal(pinned.url, published.url);
  const capabilityId = new URL(published.url).hostname.split(".")[0];
  const manifest = await localHarness.artifacts.get(`content-capabilities/v1/${capabilityId}.json`);
  const token = JSON.parse(await new Response(manifest.body).text()).signed_token;
  const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url"));
  assert.equal(payload.exp, null);
  await publish([source("index.txt", "new bytes")], { artifactId: published.artifact_id, mode: { kind: "paths" } });
  const updated = await fetch(published.url);
  assert.equal(await updated.text(), "new bytes");
  const cached = await fetch(new URL("asset.css", published.url), { headers: { "If-None-Match": etag } });
  assert.equal(cached.status, 304);
  checks.push(
    "Pinned content serves past former expiry; unpin grants fresh policy lifetime; manifest exp is null after re-pin; stable capability serves updates and unchanged ETag returns 304",
  );

  // A short TTL exercises real signed PUT rejection and target renewal, without
  // changing clocks or signatures in the upload or content implementations.
  localHarness.uploadEnv.UPLOAD_URL_TTL_SECONDS = "1";
  try {
    const bytes = new TextEncoder().encode("renewed upload");
    const session = await api.uploadSessions.create(
      {
        title: "Renewal",
        entrypoint: "index.txt",
        commit: { guard: "snapshot", snapshot: { prefix: null, sha256: empty } },
        files: [{ path: "index.txt", size_bytes: bytes.length, sha256: hash(bytes) }],
      },
      key(),
    );
    const original = session.files[0];
    await delay(2100);
    await assert.rejects(() => api.putFile(original.put_url, bytes, original.required_headers));
    const targets = await api.uploadSessions.targets(session.upload_session_id);
    const renewed = targets.targets[0];
    assert.notEqual(renewed.put_url, original.put_url);
    await api.putFile(renewed.put_url, bytes, renewed.required_headers);
    checks.push("Expired signed PUT fails and targets issues a fresh usable URL");
  } finally {
    localHarness.uploadEnv.UPLOAD_URL_TTL_SECONDS = "900";
  }

  checks.push(await assertQuotaReservation(localHarness, urls, client));
  return checks;
}

async function assertQuotaReservation(localHarness, urls, client) {
  const quota = await provisionSmokeWorkspace(urls.api, { email: `quota-${Date.now()}@example.test`, name: "Quota" });
  const quotaWorkspace = localHarness.services.repo.workspaces.get(quota.workspace.id);
  localHarness.services.repo.workspaces.set(quota.workspace.id, {
    ...quotaWorkspace,
    storage_budget_bytes: 1.5 * 2 ** 30,
  });
  const q = client(quota.api_key.secret);
  const request = (offset) => ({
    title: "Quota reservation",
    entrypoint: "0.bin",
    commit: { guard: "snapshot", snapshot: { prefix: null, sha256: empty } },
    files: Array.from({ length: 5 }, (_, n) => {
      const size = n === 4 ? 24 * 2 ** 20 : 250 * 2 ** 20;
      return {
        path: `${n}.bin`,
        size_bytes: size,
        sha256: hash(`${offset}-${n}`),
        chunks: {
          chunk_bytes: 4 * 2 ** 20,
          sha256: Array.from({ length: Math.ceil(size / (4 * 2 ** 20)) }, (_, i) => hash(`${offset}-${n}-${i}`)),
        },
      };
    }),
  });
  const raced = await Promise.allSettled([
    q.uploadSessions.create(request(0), key()),
    q.uploadSessions.create(request(1), key()),
  ]);
  assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(raced.find((r) => r.status === "rejected").reason.code, "storage_quota_exceeded");
  const usage = await q.usage.get();
  assert.equal(usage.reserved_bytes, 2 ** 30);
  assert(usage.used_bytes + usage.reserved_bytes <= usage.budget_bytes);
  return "Concurrent 1 GiB reservations against a 1.5 GiB local workspace admit exactly one session";
}
