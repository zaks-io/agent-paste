#!/usr/bin/env node
import { spawn } from "node:child_process";
// End-to-end smoke for ADR 0087 Stage 4 intra-file patch reconstruction. Unlike the
// unit/integration tests (which use a fake reconstructor), this drives the REAL path:
// boots the local MVP server (real encryption ring + in-memory R2 that round-trips
// ciphertext), publishes a base Revision with known bytes, then create-session with a
// real `base_revision_id` + unified-diff `patch`, PUTs the diff bytes (encrypted under
// revision AAD), finalizes (the real RevisionReconstructor decrypts the base blob,
// applies the diff, hash-verifies, re-encrypts under blob AAD), publishes, and fetches
// the served content asserting it is byte-identical to applying the patch locally. Also
// asserts the conflict path: a diff whose result digest is wrong fails with patch_conflict.
import { createHash } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { waitForHarnessHealth } from "./lib/smoke-port.mjs";
import { provisionSmokeWorkspace, smokeHarnessSecretFromEnv, waitForHealthz } from "./smoke-harness.mjs";

const root = new URL("..", import.meta.url);
// Targets: `local` (in-memory MVP harness, default), `preview` (persistent preview env),
// `pr` (per-PR ephemeral preview deploy). Hosted targets mirror scripts/smoke-hosted.mjs
// env resolution so CI can reuse the same secrets.
const target = (process.argv[2] ?? "local").toLowerCase();
const isLocal = target === "local";
const apiPort = intEnv("AGENT_PASTE_LOCAL_API_PORT", 8787);
const uploadPort = intEnv("AGENT_PASTE_LOCAL_UPLOAD_PORT", 8788);
const contentPort = intEnv("AGENT_PASTE_LOCAL_CONTENT_PORT", 8789);
const jobsPort = intEnv("AGENT_PASTE_LOCAL_JOBS_PORT", 8790);
const hosted = hostedConfig(target);
const apiBaseUrl = isLocal ? `http://127.0.0.1:${apiPort}` : hosted.apiBaseUrl;
const uploadBaseUrl = isLocal ? `http://127.0.0.1:${uploadPort}` : hosted.uploadBaseUrl;
const jobsBaseUrl = isLocal ? `http://127.0.0.1:${jobsPort}` : "";
const harnessSecret = smokeHarnessSecretFromEnv();
const serverEntry = fileURLToPath(new URL("./local-mvp-server.mjs", import.meta.url));

function hostedConfig(name) {
  if (name === "local") {
    return { apiBaseUrl: "", uploadBaseUrl: "", harnessSecret: "" };
  }
  if (name === "preview") {
    return {
      apiBaseUrl: env("AGENT_PASTE_PREVIEW_API_URL", "https://agent-paste-api-preview.isaac-a46.workers.dev"),
      uploadBaseUrl: env("AGENT_PASTE_PREVIEW_UPLOAD_URL", "https://agent-paste-upload-preview.isaac-a46.workers.dev"),
      harnessSecret: env("AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET", env("AGENT_PASTE_SMOKE_HARNESS_SECRET", "")),
    };
  }
  if (name === "pr") {
    return {
      apiBaseUrl: requiredEnv("AGENT_PASTE_PR_API_URL"),
      uploadBaseUrl: requiredEnv("AGENT_PASTE_PR_UPLOAD_URL"),
      harnessSecret: env("AGENT_PASTE_PR_SMOKE_HARNESS_SECRET", env("AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET", "")),
    };
  }
  throw new Error(`unknown target "${name}" (expected local, preview, or pr)`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env ${name} for target ${target}`);
  }
  return value;
}

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const enc = new TextEncoder();

const server = isLocal
  ? spawn(process.execPath, [serverEntry], {
      cwd: root,
      env: {
        ...process.env,
        AGENT_PASTE_LOCAL_API_PORT: String(apiPort),
        AGENT_PASTE_LOCAL_UPLOAD_PORT: String(uploadPort),
        AGENT_PASTE_LOCAL_CONTENT_PORT: String(contentPort),
        AGENT_PASTE_LOCAL_JOBS_PORT: String(jobsPort),
        SMOKE_HARNESS_SECRET: harnessSecret,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
  : null;
let serverLog = "";
if (server) {
  server.stdout.on("data", (c) => {
    serverLog += c.toString();
  });
  server.stderr.on("data", (c) => {
    serverLog += c.toString();
  });
}

try {
  const { ApiClient } = await import("../packages/api-client/dist/src/index.js");
  if (server) {
    await waitForHarnessHealth(
      server,
      [apiBaseUrl, jobsBaseUrl],
      { getLog: () => serverLog, timeoutMs: 10_000, sleepMs: 100 },
      waitForHealthz,
    );
  }

  const apiKeySecret = await resolveApiKey();
  assert(apiKeySecret, "resolved an API key");

  const client = new ApiClient({
    auth: { type: "api_key", apiKey: apiKeySecret },
    apiBaseUrl,
    uploadBaseUrl,
  });

  // Base Revision: index.html (entrypoint) + a large text file we will patch. Both are
  // blob-backed (sha256 set) so the patched path can inherit / be replaced cleanly.
  const indexBytes = enc.encode("<!doctype html><title>patch base</title><p>base</p>\n");
  const baseBig = enc.encode(makeBigText("line"));
  const base = await publishTree(client, "patch base", [
    { path: "index.html", bytes: indexBytes },
    { path: "big.txt", bytes: baseBig },
  ]);
  assert(base.revision_id?.startsWith("rev_"), "base publish returned a revision id");

  // Apply a real one-line edit locally to compute the expected result + its digest.
  const resultBig = enc.encode(makeBigText("line").replace("line 500\n", "LINE FIVE HUNDRED\n"));
  const diff = unifiedDiffLineSwap(500, "line 500", "LINE FIVE HUNDRED");

  // --- Happy path: patch reconstructs byte-exactly and serves through content. ---
  const revised = await publishPatch(client, {
    artifactId: base.artifact_id,
    baseRevisionId: base.revision_id,
    path: "big.txt",
    diffBytes: enc.encode(diff),
    baseSha256: sha256Hex(baseBig),
    resultSha256: sha256Hex(resultBig),
  });
  assert(revised.revision_id !== base.revision_id, "patch publish created a new revision");

  // Fetch the reconstructed file through the content path and assert byte-exactness.
  const served = await fetchArtifactFile(revised, "big.txt");
  assertBytesEqual(served, resultBig, "served big.txt is byte-identical to the locally-applied patch");

  // The entrypoint inherited unchanged from the base must still serve.
  const servedIndex = await fetchArtifactFile(revised, "index.html");
  assertBytesEqual(servedIndex, indexBytes, "inherited index.html still serves byte-identically");

  // --- Conflict path: a diff whose declared result digest is wrong must fail loud. ---
  let conflict;
  try {
    await publishPatch(client, {
      artifactId: base.artifact_id,
      baseRevisionId: revised.revision_id,
      path: "big.txt",
      diffBytes: enc.encode(unifiedDiffLineSwap(500, "LINE FIVE HUNDRED", "broken edit", resultBig)),
      baseSha256: sha256Hex(resultBig),
      resultSha256: "0".repeat(64), // deliberately wrong → result_hash_mismatch
    });
  } catch (error) {
    conflict = error;
  }
  assert(conflict, "a patch with a wrong result digest must throw");
  assert(
    conflict.code === "patch_conflict",
    `conflict code should be patch_conflict, got ${conflict.code} (${conflict.message})`,
  );
  assert(conflict.status === 422, `conflict status should be 422, got ${conflict.status}`);
  assert(
    typeof conflict.message === "string" && conflict.message.includes("big.txt"),
    `conflict message should name the path: ${conflict.message}`,
  );

  process.stdout.write(`Patch smoke passed (${target}).

  Base revision:    ${base.revision_id}
  Patched revision: ${revised.revision_id}
  Reconstructed big.txt served byte-exact (${resultBig.byteLength} bytes from a ${diff.length}-byte diff).
  Conflict path: ${conflict.code} (${conflict.status}) — "${conflict.message}"

`);
} catch (error) {
  process.stderr.write(`Patch smoke failed (${target}): ${error instanceof Error ? error.message : String(error)}\n`);
  if (serverLog.trim()) {
    process.stderr.write(`\nLocal server output:\n${serverLog}\n`);
  }
  process.exitCode = 1;
} finally {
  if (server) {
    server.kill("SIGTERM");
    await Promise.race([once(server, "exit"), delay(1000)]).catch(() => undefined);
    if (server.exitCode === null) {
      server.kill("SIGKILL");
      await Promise.race([once(server, "exit"), delay(1000)]).catch(() => undefined);
    }
  }
}

function env(name, fallback) {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

// Mirror scripts/smoke-hosted.mjs credential resolution: a preprovisioned key wins;
// otherwise provision via the target's harness secret (local default for the harness,
// the per-env harness secret for preview/pr).
async function resolveApiKey() {
  const preprovisioned = env("AGENT_PASTE_SMOKE_API_KEY", "");
  if (preprovisioned) {
    return preprovisioned;
  }
  const secret = isLocal ? harnessSecret : hosted.harnessSecret;
  if (!secret) {
    throw new Error(`no API key or harness secret available for target ${target}`);
  }
  const provisioned = await provisionSmokeWorkspace(apiBaseUrl, {
    email: `patch-${Date.now()}@example.test`,
    name: "Patch Smoke",
    secret,
  });
  assert(provisioned.api_key?.secret, "provision returned an API key");
  return provisioned.api_key.secret;
}

// Publish a full-manifest tree of { path, bytes } via create-session → PUT → finalize →
// publish, returning the publish result.
async function publishTree(client, title, files) {
  const idem = `base-${Date.now()}-${Math.round(performance.now())}`;
  const session = await client.uploadSessions.create(
    {
      title,
      entrypoint: "index.html",
      files: files.map((f) => ({ path: f.path, size_bytes: f.bytes.byteLength, sha256: sha256Hex(f.bytes) })),
    },
    idem,
  );
  await putTargets(client, session, files);
  const finalized = await client.uploadSessions.finalize(session.upload_session_id, `${idem}-fin`);
  return client.revisions.publish(finalized.artifact_id, finalized.revision_id, `${idem}-pub`);
}

// Publish a partial-manifest revision carrying a single patched file.
async function publishPatch(client, input) {
  const idem = `patch-${Date.now()}-${Math.round(performance.now())}`;
  const session = await client.uploadSessions.create(
    {
      artifact_id: input.artifactId,
      base_revision_id: input.baseRevisionId,
      title: "patched",
      entrypoint: "index.html",
      files: [
        {
          path: input.path,
          size_bytes: input.diffBytes.byteLength,
          patch: { base_sha256: input.baseSha256, format: "unified", result_sha256: input.resultSha256 },
        },
      ],
    },
    idem,
  );
  await putTargets(client, session, [{ path: input.path, bytes: input.diffBytes }]);
  const finalized = await client.uploadSessions.finalize(session.upload_session_id, `${idem}-fin`);
  return client.revisions.publish(finalized.artifact_id, finalized.revision_id, `${idem}-pub`);
}

async function putTargets(client, session, files) {
  for (const target of session.files) {
    if (target.status !== "upload_required") {
      continue;
    }
    const file = files.find((f) => f.path === target.path);
    assert(file, `no bytes for upload target ${target.path}`);
    await client.putFile(target.put_url, file.bytes, target.required_headers);
  }
}

// Fetch one file of a published artifact through the content origin via the agent view.
async function fetchArtifactFile(publishResult, path) {
  const agentView = await fetchJson(publishResult.agent_view_url);
  const file = agentView.files.find((f) => f.path === path);
  assert(file, `agent view did not list ${path}`);
  const response = await fetch(file.url);
  assert(response.status === 200, `content fetch for ${path} returned ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function makeBigText(prefix) {
  const lines = [];
  for (let i = 1; i <= 1000; i++) {
    lines.push(`${prefix} ${i}`);
  }
  return `${lines.join("\n")}\n`;
}

// Build a minimal valid unified diff swapping one line (3 lines of context each side),
// computed against the real surrounding lines so it applies cleanly.
function unifiedDiffLineSwap(lineNo, from, to, baseOverride) {
  const baseText = baseOverride ? new TextDecoder().decode(baseOverride) : makeBigText("line");
  const lines = baseText.split("\n");
  const idx = lineNo - 1;
  assert(lines[idx] === from, `expected base line ${lineNo} to be "${from}", got "${lines[idx]}"`);
  const ctxBefore = [lines[idx - 3], lines[idx - 2], lines[idx - 1]];
  const ctxAfter = [lines[idx + 1], lines[idx + 2], lines[idx + 3]];
  const oldStart = lineNo - 3;
  return [
    `@@ -${oldStart},7 +${oldStart},7 @@`,
    ...ctxBefore.map((l) => ` ${l}`),
    `-${from}`,
    `+${to}`,
    ...ctxAfter.map((l) => ` ${l}`),
    "",
  ].join("\n");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function assertBytesEqual(actual, expected, message) {
  if (actual.byteLength !== expected.byteLength) {
    throw new Error(`${message}: length ${actual.byteLength} !== ${expected.byteLength}`);
  }
  for (let i = 0; i < actual.byteLength; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`${message}: byte ${i} differs (${actual[i]} !== ${expected[i]})`);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
