#!/usr/bin/env node
// Requires a built CLI and an explicitly selected local or preview environment.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiClient, createIdempotencyKey, executePublish, planPublish } from "../packages/api-client/dist/src/index.js";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
};
if (args.includes("--help")) {
  console.log(
    "node scripts/transfer-soak.mjs --api <local-or-preview-url> --upload <url> [--output <directory>] [--updates 150] [--checkpoint-timeout-ms 60000] [--concurrent 3]",
  );
  process.exit(0);
}
if (args.includes("--probe-self-test")) {
  await probeSelfTest();
  process.exit(0);
}
const apiUrl = flag("api");
const uploadUrl = flag("upload");
for (const value of [apiUrl, uploadUrl]) {
  assert(value, "Explicit --api and --upload are required");
  const url = new URL(value);
  assert(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || /preview/i.test(url.hostname),
    "Only local or preview endpoints are permitted",
  );
  assert(["http:", "https:"].includes(url.protocol), "Expected HTTP endpoint");
}
const output = flag("output") ?? (await mkdtemp(path.join(os.tmpdir(), "agent-paste-transfer-soak-")));
await mkdir(output, { recursive: true, mode: 0o700 });
const cli = fileURLToPath(new URL("../apps/cli/dist/index.js", import.meta.url));
const env = {
  ...process.env,
  AGENT_PASTE_API_URL: apiUrl,
  AGENT_PASTE_UPLOAD_URL: uploadUrl,
  XDG_CONFIG_HOME: path.join(output, "config"),
};
// This preload observes only the owned child. IPC contains byte counts and
// plaintext digests, never request URLs, headers, bodies or credentials.
function probeSource(interrupt) {
  return `
    import { promises as fs } from "node:fs";
    import { createHash } from "node:crypto";
    const interrupt = ${JSON.stringify(interrupt)};
    const send = (event) => process.send?.(event);
    const pause = async (kind) => {
      if (interrupt !== kind) return;
      send({ type: "checkpoint", kind });
      await new Promise(() => { setInterval(() => {}, 1000); });
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const response = await originalFetch(url, init);
      if (init?.method === "PUT" && response.ok && init.body instanceof Uint8Array) {
        send({ type: "upload", bytes: init.body.byteLength, sha256: createHash("sha256").update(init.body).digest("hex") });
        await pause("upload");
      }
      const range = new Headers(init?.headers).get("Range");
      if (range) send({ type: "range", start: Number(range.match(/^bytes=(\\d+)-$/)?.[1]), status: response.status });
      return response;
    };
    const originalOpen = fs.open.bind(fs);
    fs.open = async (filename, ...args) => {
      const handle = await originalOpen(filename, ...args);
      if (String(filename).endsWith(".data")) {
        const originalWrite = handle.write.bind(handle);
        let bytes = 0;
        handle.write = async (...args) => {
          const result = await originalWrite(...args);
          bytes += result.bytesWritten;
          send({ type: "partial", bytes });
          if (bytes >= 1024 * 1024) await pause("download");
          return result;
        };
      }
      return handle;
    };
  `;
}
async function probeSelfTest() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "transfer-probe-"));
  const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
  try {
    for (const kind of ["upload", "download", undefined]) {
      const messages = [];
      const code =
        kind === "download"
          ? `import { promises as fs } from "node:fs"; const handle = await fs.open(${JSON.stringify(path.join(directory, "owned.data"))}, "w"); await handle.write(new Uint8Array(1048576)); await handle.close();`
          : `await fetch("https://probe.invalid/", { method: "PUT", body: new Uint8Array([1, 2, 3]) }); await fetch("https://probe.invalid/", { headers: { Range: "bytes=123-" } });`;
      const fake = `globalThis.fetch = async (_url, init) => new Response(null, { status: new Headers(init?.headers).has("Range") ? 206 : 200 });`;
      const child = spawn(
        process.execPath,
        ["--import", moduleUrl(fake), "--import", moduleUrl(probeSource(kind)), "--input-type=module", "-e", code],
        { stdio: ["ignore", "ignore", "inherit", "ipc"] },
      );
      child.on("message", (event) => {
        messages.push(event);
        if (event.type === "checkpoint") child.kill("SIGKILL");
      });
      const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
      const result = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      clearTimeout(timeout);
      if (kind) {
        assert.equal(result.signal, "SIGKILL");
        assert(messages.some((event) => event.type === "checkpoint" && event.kind === kind));
        assert(
          messages.some((event) =>
            kind === "upload"
              ? event.type === "upload" && event.bytes === 3
              : event.type === "partial" && event.bytes === 1048576,
          ),
        );
      } else {
        assert.equal(result.code, 0);
        assert(messages.some((event) => event.type === "range" && event.start === 123 && event.status === 206));
      }
      assert(!JSON.stringify(messages).includes("https:"), "Probe evidence must not contain URLs");
    }
    console.log("Transfer probe passed: acknowledged PUT, persisted partial checkpoint, Range/206 and sanitized IPC");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const runs = [];
const run = async (command, { interrupt, allowFailure = false } = {}) => {
  const probe = `data:text/javascript,${encodeURIComponent(probeSource(interrupt))}`;
  const child = spawn(process.execPath, ["--import", probe, cli, ...command, "--json"], {
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const evidence = { uploads: [], ranges: [], partial_bytes: 0, checkpoint: false };
  child.on("message", (event) => {
    if (event.type === "upload") evidence.uploads.push({ bytes: event.bytes, sha256: event.sha256 });
    if (event.type === "range") evidence.ranges.push({ start: event.start, status: event.status });
    if (event.type === "partial") evidence.partial_bytes = Math.max(evidence.partial_bytes, event.bytes);
    if (event.type === "checkpoint" && event.kind === interrupt) {
      evidence.checkpoint = true;
      child.kill("SIGKILL");
    }
  });
  let stdout = "";
  let stderr = "";
  let peakRssKiB = 0;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const monitor = setInterval(async () => {
    try {
      const status = await readFile(`/proc/${child.pid}/status`, "utf8");
      peakRssKiB = Math.max(peakRssKiB, Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1] ?? 0));
    } catch {
      /* The owned child may exit between sampling and reading. */
    }
  }, 20);
  const timer = interrupt
    ? setTimeout(() => child.kill("SIGKILL"), Number(flag("checkpoint-timeout-ms", "60000")))
    : undefined;
  const { code, signal } = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearInterval(monitor);
  clearTimeout(timer);
  const record = { command: command[0], code, interrupted: Boolean(interrupt), peak_rss_kib: peakRssKiB, evidence };
  runs.push(record);
  assert(peakRssKiB > 0, "No owned child RSS sample was recorded");
  assert(peakRssKiB <= 400 * 1024, `CLI exceeded 400 MiB: ${peakRssKiB} KiB`);
  if (interrupt) {
    assert(evidence.checkpoint, "No transfer checkpoint observed before exit/timeout");
    assert.equal(signal, "SIGKILL");
    return record;
  }
  if (code !== 0) {
    if (allowFailure) return { failed: true, code };
    // Do not persist raw diagnostics: they can contain signed content URLs.
    let errorCode = "unknown";
    try {
      const candidate = JSON.parse(stderr).error?.code;
      if (typeof candidate === "string" && /^[a-z0-9_]{1,100}$/.test(candidate)) errorCode = candidate;
    } catch {
      /* A non-JSON diagnostic is deliberately omitted. */
    }
    await writeFile(
      path.join(output, `failure-${runs.length}.json`),
      JSON.stringify({ exit_code: code, error_code: errorCode }),
      { mode: 0o600 },
    );
    await writeFile(path.join(output, `private-cli-${runs.length}.log`), `${stderr}\n${stdout}`, { mode: 0o600 });
    throw new Error(`CLI ${command[0]} exited ${code}; sanitized failure evidence recorded`);
  }
  return { ...JSON.parse(stdout), transfer_evidence: evidence };
};
async function randomFile(filename, size) {
  await mkdir(path.dirname(filename), { recursive: true });
  const handle = await open(filename, "w", 0o600);
  try {
    for (let offset = 0; offset < size; ) {
      const bytes = randomBytes(Math.min(4 * 1024 * 1024, size - offset));
      let written = 0;
      while (written < bytes.length)
        written += (await handle.write(bytes, written, bytes.length - written)).bytesWritten;
      offset += bytes.length;
    }
  } finally {
    await handle.close();
  }
}
async function digest(filename) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  return hash.digest("hex");
}
async function compareTrees(source, target) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) await compareTrees(from, to);
    else assert.equal(await digest(from), await digest(to), `Round-trip mismatch: ${entry.name}`);
  }
}
const report = {
  output,
  runs,
  checks: [],
  manual_checks: [
    "Preview Worker analytics show no exceededMemory/exceededCpu",
    "Retained link after former expiry requires the parent-controlled preview clock/expiry fixture",
    "URL expiry renewal requires short preview UPLOAD_URL_TTL_SECONDS",
    "Browser renders 2,000 assets and unchanged ETag returns 304",
    "Quota reservation and delayed GC use the parent's preview budget fixture",
  ],
};
const check = (name) => {
  report.checks.push(name);
  console.log(name);
};
try {
  const who = await run(["whoami"]);
  assert(who.authenticated, "Use the inherited preview credential");
  const large = path.join(output, "large");
  await mkdir(large);
  await randomFile(path.join(large, "large.bin"), 262_144_000);
  const oversized = path.join(output, "oversized.bin");
  const handle = await open(oversized, "w");
  await handle.truncate(262_144_001);
  await handle.close();
  assert((await run(["publish", oversized], { allowFailure: true })).failed);
  const published = await run(["publish", large, "--pin"]);
  assert.equal(published.retention, "pinned");
  const range = await fetch(new URL("large.bin", published.url), {
    headers: { Range: "bytes=0-31", "Accept-Encoding": "identity" },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 32);
  const served = await fetch(new URL("large.bin", published.url), { headers: { "Accept-Encoding": "identity" } });
  assert.equal(served.status, 200);
  const servedHash = createHash("sha256");
  for await (const bytes of served.body) servedHash.update(bytes);
  assert.equal(servedHash.digest("hex"), await digest(path.join(large, "large.bin")));
  const pulled = path.join(output, "pulled-large");
  await run(["pull", published.artifact_id, "--output", pulled]);
  await compareTrees(large, pulled);
  check("250 MiB publish, Range and verified pull; oversize client rejection");
  const unchanged = await run(["publish", large, "--artifact-id", published.artifact_id]);
  assert(unchanged.no_change);
  assert.equal(unchanged.transfer_evidence.uploads.length, 0);
  assert.equal(unchanged.revision_id, published.revision_id);
  check("No-op sends no bytes and preserves revision");
  // Unique bytes prevent the earlier publish from making this a dedup-only run.
  const resumeSource = path.join(output, "resume-source");
  await mkdir(resumeSource);
  await randomFile(path.join(resumeSource, "large.bin"), 262_144_000);
  const interrupted = await run(["publish", resumeSource], { interrupt: "upload" });
  assert(interrupted.evidence.uploads.length > 0, "Must acknowledge at least one uploaded chunk before kill");
  const resumed = await run(["publish", resumeSource]);
  const acknowledged = new Set(interrupted.evidence.uploads.map((chunk) => chunk.sha256));
  assert(
    resumed.transfer_evidence.uploads.every((chunk) => !acknowledged.has(chunk.sha256)),
    "Resume resent an acknowledged chunk",
  );
  assert(resumed.upload_stats.uploaded_bytes < 262_144_000, "Resume must skip already stored bytes");
  const interruptedPull = await run(["pull", resumed.artifact_id, "--output", path.join(output, "resume-pull")], {
    interrupt: "download",
  });
  assert(interruptedPull.evidence.partial_bytes >= 1024 * 1024, "Must persist partial bytes before kill");
  const pulledAgain = await run(["pull", resumed.artifact_id, "--output", path.join(output, "resume-pull")]);
  assert(
    pulledAgain.transfer_evidence.ranges.some((range) => range.start > 0 && range.status === 206),
    "Resume must receive a nonzero Range response",
  );
  await compareTrees(resumeSource, path.join(output, "resume-pull"));
  check("Acknowledged upload chunks are not resent; persisted pull resumes with nonzero Range/206 and matches hashes");
  for (const kind of ["small", "mixed"]) {
    const tree = path.join(output, kind);
    await mkdir(tree);
    if (kind === "small") {
      for (let n = 0; n < 8000; n++) await randomFile(path.join(tree, `file-${n}.bin`), Math.ceil(2 ** 30 / 8000));
    } else {
      for (let n = 0; n < 4; n++) await randomFile(path.join(tree, `large-${n}.bin`), 262_144_000);
      for (let n = 0; n < 200; n++)
        await randomFile(path.join(tree, `small-${n}.bin`), Math.ceil((2 ** 30 - 4 * 262_144_000) / 200));
    }
    await writeFile(path.join(tree, "index.html"), "<!doctype html><title>Static transfer soak</title>");
    const result = await run(["publish", tree]);
    const target = path.join(output, `${kind}-pull`);
    await run(["pull", result.artifact_id, "--output", target]);
    await compareTrees(tree, target);
    const selection = kind === "small" ? "file-0.bin" : "small-0.bin";
    await run(["pull", result.artifact_id, selection, "--output", path.join(output, `selected-${kind}-pull`)]);
    check(`${kind}: >=1 GiB round trip`);
  }
  const selected = path.join(output, "selected.txt");
  await writeFile(selected, "selected content");
  await run(["publish", selected, "--artifact-id", published.artifact_id, "--to", "docs/selected.txt"]);
  await run(["pull", published.artifact_id, "docs", "--output", path.join(output, "partial")]);
  assert.equal(await digest(selected), await digest(path.join(output, "partial/docs/selected.txt")));
  const api = new ApiClient({ apiBaseUrl: apiUrl, uploadBaseUrl: uploadUrl });
  const t = {
    createUploadSession: api.uploadSessions.create,
    appendFiles: api.uploadSessions.appendFiles,
    targets: api.uploadSessions.targets,
    completeFiles: api.uploadSessions.completeFiles,
    listFiles: api.artifactFiles.list,
    getAgentView: (id, revision) =>
      revision ? api.artifacts.getRevisionAgentView(id, revision) : api.artifacts.getAgentView(id),
    putFile: (url, bytes, headers) => api.putFile(url, bytes, headers),
    finalize: api.uploadSessions.finalize,
    publishRevision: api.revisions.publish,
  };
  async function prepare(remotePath, body) {
    const bytes = new TextEncoder().encode(body);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const input = {
      artifactId: published.artifact_id,
      title: published.title,
      entrypoint: "large.bin",
      mode: { kind: "paths" },
      idempotencyKey: createIdempotencyKey("soak"),
      sources: [
        {
          path: remotePath,
          sizeBytes: bytes.length,
          sha256,
          contentType: "text/plain; charset=utf-8",
          readRange: async (start, n) => bytes.slice(start, start + n),
        },
      ],
    };
    return { input, plan: await planPublish(t, input) };
  }
  const [a, b] = await Promise.all([prepare("disjoint/a.txt", "a"), prepare("disjoint/b.txt", "b")]);
  await Promise.all([executePublish(t, a.plan, a.input), executePublish(t, b.plan, b.input)]);
  const disjoint = await api.artifactFiles.list(published.artifact_id);
  for (const expected of [a, b]) {
    const source = expected.input.sources[0];
    assert.equal(disjoint.items.find((file) => file.path === source.path)?.sha256, source.sha256);
  }
  const [c, d] = await Promise.all([prepare("same.txt", "c"), prepare("same.txt", "d")]);
  await executePublish(t, c.plan, c.input);
  await assert.rejects(
    () => executePublish(t, d.plan, d.input),
    (error) => error.code === "commit_conflict",
  );
  const mirror = await prepare("docs/selected.txt", "mirror change");
  mirror.input.mode = { kind: "mirror_prefix", prefix: "docs" };
  mirror.plan = await planPublish(t, mirror.input);
  const added = await prepare("docs/racing.txt", "racing addition");
  await executePublish(t, added.plan, added.input);
  await assert.rejects(
    () => executePublish(t, mirror.plan, mirror.input),
    (error) => error.code === "commit_conflict",
  );
  const preserved = path.join(output, "preserved");
  await run(["pull", published.artifact_id, "large.bin", "--output", preserved]);
  assert.equal(await digest(path.join(large, "large.bin")), await digest(path.join(preserved, "large.bin")));
  const largeView = await api.artifacts.getAgentView(published.artifact_id);
  assert.equal(largeView.bundle.status, "disabled");
  assert.equal(largeView.bundle.reason, "revision_too_large");
  check("Selected paths preserve omitted bytes; disjoint commits succeed and overlap conflicts");
  const unpinned = await run(["unpin", published.artifact_id]);
  assert.equal(unpinned.retention, "temporary");
  assert(Date.parse(unpinned.effective_expires_at) > Date.now());
  const pinned = await run(["pin", published.artifact_id]);
  assert.equal(pinned.effective_expires_at, null);
  check("Pin/unpin returns fresh retention and stable URL");
  for (let n = 0; n < Number(flag("updates", "150")); n++) {
    await writeFile(selected, `update ${n}`);
    const result = await run(["publish", selected, "--artifact-id", published.artifact_id, "--to", "updates.txt"]);
    assert.equal(result.url, published.url);
  }
  check("Repeated updates preserve the URL");
  await assert.rejects(
    () =>
      api.uploadSessions.create(
        {
          title: "Oversize rejection",
          entrypoint: "big.bin",
          commit: {
            guard: "snapshot",
            snapshot: { prefix: null, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
          },
          files: [
            {
              path: "big.bin",
              size_bytes: 262_144_001,
              sha256: "0".repeat(64),
              chunks: { chunk_bytes: 4194304, sha256: Array(63).fill("0".repeat(64)) },
            },
          ],
        },
        createIdempotencyKey("oversize"),
      ),
    (error) => error.status === 400 || error.status === 422,
  );
  const legacyBytes = new TextEncoder().encode("legacy");
  const legacy = await api.uploadSessions.create(
    {
      title: "Legacy soak",
      entrypoint: "index.txt",
      files: [
        {
          path: "index.txt",
          size_bytes: legacyBytes.length,
          sha256: createHash("sha256").update(legacyBytes).digest("hex"),
        },
      ],
    },
    createIdempotencyKey("legacy"),
  );
  for (const target of legacy.files)
    if (target.status === "upload_required") await api.putFile(target.put_url, legacyBytes, target.required_headers);
  const finalized = await api.uploadSessions.finalize(
    legacy.upload_session_id,
    createIdempotencyKey("legacy_finalize"),
  );
  const oldResult = await api.revisions.publish(
    finalized.artifact_id,
    finalized.revision_id,
    createIdempotencyKey("legacy_publish"),
  );
  assert(!("retention" in oldResult));
  check("Legacy protocol and strict publish response remain supported");
  const concurrentSources = [];
  for (let n = 0; n < Number(flag("concurrent", "3")); n++) {
    const source = path.join(output, `concurrent-source-${n}`);
    await randomFile(path.join(source, "large.bin"), 262_144_000);
    concurrentSources.push(source);
  }
  await Promise.all(
    concurrentSources.map(async (source, n) => {
      const result = await run(["publish", source, "--title", `Concurrent transfer ${n}`]);
      assert.equal(
        result.transfer_evidence.uploads.reduce((sum, chunk) => sum + chunk.bytes, 0),
        262_144_000,
      );
      const target = path.join(output, `concurrent-${n}`);
      await run(["pull", result.artifact_id, "--output", target]);
      await compareTrees(source, target);
    }),
  );
  check("Concurrent 250 MiB publishes/pulls stay within sampled CLI RSS cap");
} finally {
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`Evidence: ${path.join(output, "report.json")}`);
}
