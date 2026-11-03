import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostedTransferAcceptance } from "./smoke-hosted-transfers.mjs";

vi.mock("node:child_process", async (original) => ({ ...(await original()), spawn: vi.fn() }));

let directory;
let env;
const key = "ap_pk_preview_driver-test-only";
const secret = "driver-test-harness-only";
const sensitive = `Authorization: Bearer ${key}\nhttps://private-capability-pr-686.agent-paste.link/?token=private-token`;
let report;
let childExit;
let failureCode;
let writeReport;
let stalled;
let childReady;
let spawnFailure;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "hosted-transfers-test-"));
  childExit = { code: 0, signal: null };
  failureCode = null;
  writeReport = true;
  stalled = false;
  spawnFailure = false;
  childReady = () => {};
  env = {
    PR_NUMBER: "686",
    PR_HEAD_SHA: "a".repeat(40),
    GITHUB_SHA: "b".repeat(40),
    AGENT_PASTE_PR_API_URL: "https://agent-paste-api-pr-686.isaac-a46.workers.dev",
    AGENT_PASTE_PR_UPLOAD_URL: "https://agent-paste-upload-pr-686.isaac-a46.workers.dev",
    AGENT_PASTE_PR_CONTENT_URL: "https://agent-paste-content-pr-686.isaac-a46.workers.dev",
    AGENT_PASTE_PR_SMOKE_HARNESS_SECRET: secret,
    AGENT_PASTE_API_KEY: "unrelated-inherited-test-key",
    AGENT_PASTE_TRANSFER_OUTPUT_DIR: directory,
  };
  const run = (interrupted) => ({
    command: "publish",
    code: interrupted ? null : 0,
    interrupted,
    peak_rss_kib: 250000,
    evidence: {
      uploads: [{ bytes: 4194304, sha256: "c".repeat(64), raw: sensitive }],
      ranges: [{ start: 1048576, status: 206 }],
      partial_bytes: 1048576,
      checkpoint: interrupted,
      hosted_requests: 100,
      hosted_retries: 2,
      hosted_wait_ms: 120000,
      raw: sensitive,
    },
  });
  report = {
    status: "passed",
    checks: Array(10).fill(sensitive),
    parameters: { updates: 150, concurrent: 3 },
    fixtures: [
      { kind: "large", files: 1, bytes: 262_144_000 },
      { kind: "small", files: 8001, bytes: 2 ** 30 },
      { kind: "mixed", files: 205, bytes: 2 ** 30 },
    ],
    runs: [run(true), run(true), run(false)],
    output: sensitive,
    unexpected: sensitive,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      if (url.endsWith("/__test__/provision-smoke")) {
        expect(init).toMatchObject({
          method: "POST",
          redirect: "error",
          headers: { authorization: `Bearer ${secret}` },
        });
        return Response.json({ workspace: { id: "workspace-test" }, api_key: { secret: key } }, { status: 201 });
      }
      expect(url).toBe(`${env.AGENT_PASTE_PR_API_URL}/v1/whoami`);
      expect(init.headers.authorization).toBe(`Bearer ${key}`);
      return Response.json({ workspace: { id: "workspace-test" } });
    }),
  );
  vi.mocked(spawn).mockImplementation((_command, args, options) => {
    expect(options.env.AGENT_PASTE_API_KEY).toBe(key);
    expect(options.env.AGENT_PASTE_API_URL).toBe(env.AGENT_PASTE_PR_API_URL);
    expect(options.env.AGENT_PASTE_UPLOAD_URL).toBe(env.AGENT_PASTE_PR_UPLOAD_URL);
    expect(options.env.AGENT_PASTE_PR_SMOKE_HARNESS_SECRET).toBeUndefined();
    expect(options.env.NODE_OPTIONS).toContain("hosted-transfer-preload.mjs");
    expect(args).not.toContain(key);
    expect(args).not.toContain(secret);
    expect(args[args.indexOf("--updates") + 1]).toBe("150");
    expect(args[args.indexOf("--concurrent") + 1]).toBe("3");
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => child.emit("close", 143, null)),
    });
    queueMicrotask(async () => {
      if (spawnFailure) {
        child.emit("error", new Error(sensitive));
        return;
      }
      if (stalled) {
        child.emit("message", { type: "soak_progress", completed_checks: 3, command: "pull" });
        childReady();
        return;
      }
      const output = args[args.indexOf("--output") + 1];
      if (writeReport) await writeFile(path.join(output, "report.json"), JSON.stringify(report));
      if (failureCode) {
        await writeFile(
          path.join(output, `failure-${report.runs.length}.json`),
          JSON.stringify({ error_code: failureCode, raw: sensitive }),
        );
      }
      child.stdout.write(sensitive);
      child.stderr.write(sensitive);
      child.emit("message", { type: "hosted_request", kind: "capability", status: 200 });
      child.emit("message", { type: "soak_progress", completed_checks: 3, command: "pull" });
      child.emit("close", childExit.code, childExit.signal);
    });
    return child;
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  await rm(directory, { recursive: true, force: true });
});

async function evidence() {
  const text = await readFile(path.join(directory, "hosted-transfer-evidence.json"), "utf8");
  for (const forbidden of [key, secret, "private-token", "Authorization", "https://", "unexpected", "output"])
    expect(text).not.toContain(forbidden);
  return JSON.parse(text);
}

describe("hosted transfer driver", () => {
  it("provisions and authenticates its own workspace, runs the full soak and publishes only numeric evidence", async () => {
    expect(await hostedTransferAcceptance(env)).toBe(true);
    expect(await evidence()).toMatchObject({
      status: "passed",
      stage: "complete",
      pr_number: 686,
      head_sha: "a".repeat(40),
      soak: { updates: 150, concurrent: 3, scenario_groups: 10 },
    });
    expect(await readdir(directory)).toHaveLength(2);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("fails closed before provisioning if PR hosts are mixed or production", async () => {
    env.AGENT_PASTE_PR_UPLOAD_URL = "https://upload.agent-paste.sh";
    expect(await hostedTransferAcceptance(env)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(await evidence()).toMatchObject({ status: "failed", stage: "configuration" });
  });

  it("does not use an inherited API key when the scoped provisioning secret is missing", async () => {
    delete env.AGENT_PASTE_PR_SMOKE_HARNESS_SECRET;
    expect(await hostedTransferAcceptance(env)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("keeps a failed harness response and thrown diagnostics private", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(sensitive, { status: 404 }));
    expect(await hostedTransferAcceptance(env)).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(await evidence()).toMatchObject({ status: "failed", stage: "provision", soak: null });
  });

  it("rejects a key that authenticates a different workspace", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({ workspace: { id: "workspace-test" }, api_key: { secret: key } }, { status: 201 }),
      )
      .mockResolvedValueOnce(Response.json({ workspace: { id: "wrong-workspace" } }));
    expect(await hostedTransferAcceptance(env)).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(await evidence()).toMatchObject({ status: "failed" });
  });

  it("retains safe CLI failure diagnostics and completed checks from a failed soak", async () => {
    childExit.code = 1;
    report.status = "failed";
    report.checks.length = 3;
    report.runs.at(-1).code = 2;
    report.runs.at(-1).command = "pull";
    failureCode = "storage_unavailable";
    expect(await hostedTransferAcceptance(env)).toBe(false);
    expect(await evidence()).toMatchObject({
      status: "failed",
      stage: "soak",
      soak: null,
      failure: {
        exit_code: 1,
        signal: null,
        timed_out: false,
        completed_checks: ["large_file", "no_op", "resume"],
        command: "pull",
        cli_failures: [{ run: 3, command: "pull", exit_code: 2, error_code: "storage_unavailable" }],
      },
    });
  });

  it("does not publish an arbitrary error code or command from a failed report", async () => {
    childExit.code = 1;
    report.runs.at(-1).code = 2;
    report.runs.at(-1).command = sensitive;
    failureCode = key;
    expect(await hostedTransferAcceptance(env)).toBe(false);
    expect((await evidence()).failure.cli_failures).toEqual([
      { run: 3, command: null, exit_code: 2, error_code: "unknown" },
    ]);
  });

  it("does not report the intentional oversize rejection as the cause of a later soak failure", async () => {
    childExit.code = 1;
    report.runs.at(-1).code = 2;
    report.runs.at(-1).expected_failure = true;
    expect(await hostedTransferAcceptance(env)).toBe(false);
    expect((await evidence()).failure.cli_failures).toEqual([]);
  });

  it("retains signal and last streamed progress when a killed child writes no report", async () => {
    writeReport = false;
    childExit = { code: null, signal: "SIGKILL" };
    expect(await hostedTransferAcceptance(env)).toBe(false);
    expect((await evidence()).failure).toMatchObject({
      exit_code: null,
      signal: "SIGKILL",
      timed_out: false,
      report: "missing",
      completed_checks: ["large_file", "no_op", "resume"],
      command: "pull",
    });
  });

  it("records a timed-out soak even when SIGTERM prevents its report from being written", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stalled = true;
    const ready = new Promise((resolve) => {
      childReady = resolve;
    });
    const running = hostedTransferAcceptance(env);
    await ready;
    await vi.advanceTimersByTimeAsync(105 * 60_000);
    expect(await running).toBe(false);
    expect((await evidence()).failure).toMatchObject({
      exit_code: 143,
      timed_out: true,
      cancelled: false,
      report: "missing",
      command: "pull",
      completed_checks: ["large_file", "no_op", "resume"],
    });
  });

  it("distinguishes requested cancellation from a deadline", async () => {
    stalled = true;
    const before = new Set(process.listeners("SIGTERM"));
    const ready = new Promise((resolve) => {
      childReady = resolve;
    });
    const running = hostedTransferAcceptance(env);
    await ready;
    const stop = process.listeners("SIGTERM").find((listener) => !before.has(listener));
    stop();
    expect(await running).toBe(false);
    expect((await evidence()).failure).toMatchObject({ exit_code: 143, timed_out: false, cancelled: true });
    expect(process.listeners("SIGTERM")).not.toContain(stop);
  });

  it("kills an unresponsive child before the workflow deadline and retains the timeout outcome", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stalled = true;
    const ready = new Promise((resolve) => {
      childReady = resolve;
    });
    const running = hostedTransferAcceptance(env);
    await ready;
    const child = vi.mocked(spawn).mock.results[0].value;
    child.kill.mockImplementation((signal) => {
      if (signal === "SIGKILL") child.emit("close", null, signal);
    });
    await vi.advanceTimersByTimeAsync(105 * 60_000 + 5000);
    expect(await running).toBe(false);
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect((await evidence()).failure).toMatchObject({ exit_code: null, signal: "SIGKILL", timed_out: true });
  });

  it("records process-start failure without exposing its error", async () => {
    spawnFailure = true;
    expect(await hostedTransferAcceptance(env)).toBe(false);
    expect((await evidence()).failure).toMatchObject({ exit_code: null, spawn_failed: true, report: "missing" });
  });

  it("keeps termination diagnostics when the final report is malformed", async () => {
    report = { raw: sensitive };
    childExit = { code: 1, signal: key };
    expect(await hostedTransferAcceptance(env)).toBe(false);
    expect((await evidence()).failure).toMatchObject({
      exit_code: 1,
      signal: null,
      report: "invalid",
      command: "pull",
    });
  });

  it.each([
    "unfinished",
    "reduced_updates",
    "reduced_concurrency",
    "reduced_bytes",
    "missing_files",
    "missing_resume",
    "missing_check",
    "rss_cap",
  ])("rejects incomplete acceptance evidence: %s", async (failure) => {
    if (failure === "unfinished") report.status = "failed";
    if (failure === "reduced_updates") report.parameters.updates = 1;
    if (failure === "reduced_concurrency") report.parameters.concurrent = 1;
    if (failure === "reduced_bytes") report.fixtures[1].bytes = 1024;
    if (failure === "missing_files") report.fixtures[1].files = 100;
    if (failure === "missing_resume") report.runs.shift();
    if (failure === "missing_check") report.checks.pop();
    if (failure === "rss_cap") report.runs[0].peak_rss_kib = 500000;
    expect(await hostedTransferAcceptance(env)).toBe(false);
    expect(await evidence()).toMatchObject({ status: "failed", stage: "evidence", soak: null });
  });
});
