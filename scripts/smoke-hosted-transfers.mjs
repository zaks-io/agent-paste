#!/usr/bin/env node
// @ts-check
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ErrorCode } from "../packages/contracts/dist/common.js";
import { hostedTransferFetch } from "./lib/hosted-transfer-fetch.mjs";
import { hostedTransferEndpoints } from "./lib/transfer-endpoints.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const preload = fileURLToPath(new URL("./hosted-transfer-preload.mjs", import.meta.url));
const commands = ["whoami", "publish", "pull", "pin", "unpin"];
const checks = [
  "large_file",
  "no_op",
  "resume",
  "small_tree",
  "mixed_tree",
  "partial_conflicts",
  "retention",
  "updates",
  "legacy",
  "concurrent",
];
const safeNumber = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const safeCommand = (value) => (commands.includes(value) ? value : null);

async function soakDiagnostics(directory, outcome, progress) {
  let report;
  let reportState = "available";
  try {
    report = JSON.parse(await readFile(path.join(directory, "report.json"), "utf8"));
    if (!report || !Array.isArray(report.runs) || !Array.isArray(report.checks)) throw new Error("Invalid report");
  } catch (error) {
    report = null;
    reportState = error.code === "ENOENT" ? "missing" : "invalid";
  }
  const count = report?.checks.length ?? progress.completed_checks;
  const failure = {
    exit_code: safeNumber(outcome.exit_code),
    signal: ["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT", "SIGSEGV", "SIGBUS"].includes(outcome.signal)
      ? outcome.signal
      : null,
    timed_out: outcome.timed_out === true,
    cancelled: outcome.cancelled === true,
    spawn_failed: outcome.spawn_failed === true,
    report: reportState,
    completed_checks: checks.slice(0, safeNumber(count) !== null && count <= checks.length ? count : 0),
    command: safeCommand(progress.command) ?? safeCommand(report?.runs.at(-1)?.command),
    completed_runs: report ? report.runs.filter((run) => run?.code === 0).length : 0,
    cli_failures: [],
  };
  for (const [index, run] of (report?.runs ?? []).entries()) {
    if (!run || run.code === 0 || run.interrupted === true || run.expected_failure === true) continue;
    let code = "unknown";
    try {
      const data = JSON.parse(await readFile(path.join(directory, `failure-${index + 1}.json`), "utf8"));
      const parsed = ErrorCode.safeParse(data.error_code);
      if (parsed.success) code = parsed.data;
    } catch {
      /* Missing or malformed diagnostics must not hide the process outcome. */
    }
    failure.cli_failures.push({
      run: index + 1,
      command: safeCommand(run.command),
      exit_code: safeNumber(run.code),
      error_code: code,
    });
  }
  return { report, failure };
}

function integer(value) {
  assert(Number.isSafeInteger(value) && value >= 0, "Invalid numeric soak evidence");
  return value;
}

function sanitizeSoak(report) {
  assert(report.status === "passed" && report.checks.length === 10, "The full soak did not finish");
  assert(report.parameters.updates === 150 && report.parameters.concurrent === 3, "Reduced acceptance parameters");
  const fixtures = ["large", "small", "mixed"].map((kind) => {
    const fixture = report.fixtures.find((item) => item.kind === kind);
    assert(fixture && fixture.files === { large: 1, small: 8001, mixed: 205 }[kind], "Incomplete fixture evidence");
    integer(fixture.bytes);
    assert(kind === "large" ? fixture.bytes === 262_144_000 : fixture.bytes >= 2 ** 30, "Reduced fixture bytes");
    return { kind, files: fixture.files, bytes: fixture.bytes };
  });
  const runs = report.runs.map((run) => {
    assert(commands.includes(run.command), "Unexpected CLI evidence");
    const e = run.evidence;
    return {
      command: run.command,
      exit_code: run.code === null ? null : integer(run.code),
      interrupted: run.interrupted === true,
      expected_failure: run.expected_failure === true,
      peak_rss_kib: integer(run.peak_rss_kib),
      uploads: e.uploads.map((chunk) => {
        assert(
          typeof chunk.sha256 === "string" && /^[a-f0-9]{64}$/.test(chunk.sha256),
          "Invalid upload digest evidence",
        );
        return { bytes: integer(chunk.bytes), sha256: chunk.sha256 };
      }),
      ranges: e.ranges.map((range) => ({ start: integer(range.start), status: integer(range.status) })),
      partial_bytes: integer(e.partial_bytes),
      checkpoint: e.checkpoint === true,
      hosted_requests: integer(e.hosted_requests),
      hosted_retries: integer(e.hosted_retries),
      hosted_wait_ms: integer(e.hosted_wait_ms),
    };
  });
  assert(
    runs.every((run) => run.peak_rss_kib > 0 && run.peak_rss_kib <= 400 * 1024),
    "Invalid CLI RSS evidence",
  );
  assert(runs.filter((run) => run.interrupted && run.checkpoint).length === 2, "Missing interruption evidence");
  return { scenario_groups: 10, updates: 150, concurrent: 3, fixtures, runs };
}

async function runSoak(config, env, directory, onMessage) {
  const child = spawn(
    process.execPath,
    [
      "scripts/transfer-soak.mjs",
      "--api",
      config.api,
      "--upload",
      config.upload,
      "--output",
      directory,
      "--updates",
      "150",
      "--concurrent",
      "3",
      "--checkpoint-timeout-ms",
      "300000",
    ],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  // Never forward child output: assertion errors can contain capability URLs.
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (data) => stdout.push(data));
  child.stderr.on("data", (data) => stderr.push(data));
  child.on("message", onMessage);
  let timedOut = false;
  let cancelled = false;
  let killTimer;
  const terminate = () => {
    child.kill("SIGTERM");
    killTimer ??= setTimeout(() => child.kill("SIGKILL"), 5000);
  };
  const stop = () => {
    cancelled = true;
    terminate();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const timer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, 105 * 60_000);
  try {
    return await new Promise((resolve) => {
      const finish = (code, signal, spawnFailed) =>
        resolve({
          exit_code: code,
          signal,
          timed_out: timedOut,
          cancelled,
          spawn_failed: spawnFailed,
        });
      child.once("error", (error) => {
        stderr.push(Buffer.from(String(error)));
        finish(null, null, true);
      });
      child.once("close", (code, signal) => finish(code, signal, false));
    });
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await writeFile(path.join(directory, "private-soak-stdout.log"), Buffer.concat(stdout), { mode: 0o600 });
    await writeFile(path.join(directory, "private-soak-stderr.log"), Buffer.concat(stderr), { mode: 0o600 });
  }
}

export async function hostedTransferAcceptance(env = process.env) {
  assert(env.AGENT_PASTE_TRANSFER_OUTPUT_DIR, "Set a disk-backed AGENT_PASTE_TRANSFER_OUTPUT_DIR");
  const output = path.resolve(env.AGENT_PASTE_TRANSFER_OUTPUT_DIR);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(output, "private-"));
  const evidence = {
    status: "failed",
    stage: "configuration",
    pr_number: null,
    head_sha: /^[a-f0-9]{40}$/.test(env.PR_HEAD_SHA ?? "") ? env.PR_HEAD_SHA : null,
    checkout_sha: /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ? env.GITHUB_SHA : null,
    routing: "Matching PR Workers and PR capability suffix enforced; redirects forbidden",
    direct_requests: 0,
    direct_retries: 0,
    direct_wait_ms: 0,
    soak: null,
    failure: null,
    pending: [
      "worker_memory_cpu_telemetry",
      "managed_gateway",
      "browser_2000_assets",
      "expiry_renewal",
      "retention_past_expiry",
      "quota_gc",
    ],
  };
  const progress = { completed_checks: 0, command: null };
  const onEvent = (event) => {
    if (event.type === "soak_progress") {
      if (safeNumber(event.completed_checks) !== null && event.completed_checks <= checks.length) {
        progress.completed_checks = event.completed_checks;
      }
      progress.command = safeCommand(event.command);
    }
    if (event.type === "hosted_request") evidence.direct_requests++;
    if (event.type === "hosted_retry") {
      evidence.direct_retries++;
      evidence.direct_wait_ms += integer(event.wait_ms);
    }
  };
  try {
    const config = hostedTransferEndpoints(env);
    evidence.pr_number = Number(config.pr);
    const secret = env.AGENT_PASTE_PR_SMOKE_HARNESS_SECRET;
    assert(secret, "The deploy step's scoped PR smoke secret is required");
    evidence.stage = "provision";
    const response = await fetch(`${config.api}/__test__/provision-smoke`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({
        email: `hosted-transfers-${randomUUID()}@example.test`,
        name: "Hosted transfer acceptance",
      }),
    });
    assert(response.status === 201, "Preview harness provisioning failed");
    const provisioned = /** @type {any} */ (await response.json());
    const key = provisioned.api_key?.secret;
    assert(typeof key === "string" && key.startsWith("ap_pk_preview_"), "Invalid provisioned preview key");
    assert(provisioned.workspace?.id, "Missing provisioned workspace");
    const fetchImpl = hostedTransferFetch(config, key, { onEvent });
    const who = await fetchImpl(`${config.api}/v1/whoami`, { headers: { authorization: `Bearer ${key}` } });
    assert(who.ok, "Provisioned workspace authentication failed");
    const identity = /** @type {any} */ (await who.json());
    assert.equal(identity.workspace.id, provisioned.workspace.id, "Provisioned key belongs to another workspace");
    evidence.stage = "soak";
    const childEnv = /** @type {NodeJS.ProcessEnv} */ ({
      ...env,
      AGENT_PASTE_API_KEY: key,
      AGENT_PASTE_API_URL: config.api,
      AGENT_PASTE_UPLOAD_URL: config.upload,
    });
    // CLI grandchildren inherit this preload. Do not pass the provisioning secret.
    delete childEnv.AGENT_PASTE_PR_SMOKE_HARNESS_SECRET;
    childEnv.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import=${preload}`.trim();
    const outcome = await runSoak(config, childEnv, directory, onEvent);
    const diagnostics = await soakDiagnostics(directory, outcome, progress);
    evidence.failure = diagnostics.failure;
    assert(
      evidence.failure.exit_code === 0 &&
        !evidence.failure.timed_out &&
        !evidence.failure.cancelled &&
        !evidence.failure.spawn_failed,
      "Hosted transfer soak failed",
    );
    evidence.stage = "evidence";
    evidence.soak = sanitizeSoak(diagnostics.report);
    evidence.failure = null;
    evidence.status = "passed";
    evidence.stage = "complete";
  } catch (error) {
    await writeFile(path.join(directory, "private-driver-error.log"), String(error?.stack ?? error), { mode: 0o600 });
  } finally {
    // This exact file is the only allowed CI artifact. No raw report spread.
    await writeFile(path.join(output, "hosted-transfer-evidence.json"), JSON.stringify(evidence, null, 2), {
      mode: 0o600,
    });
  }
  return evidence.status === "passed";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const passed = await hostedTransferAcceptance();
    console.log(
      `Hosted large-transfer acceptance ${passed ? "passed" : "failed"}. See sanitized evidence; private diagnostics are not published.`,
    );
    process.exitCode = passed ? 0 : 1;
  } catch {
    console.error("Hosted large-transfer driver could not prepare its private output directory.");
    process.exitCode = 1;
  }
}
