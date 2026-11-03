#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { provisionSmokeWorkspace, waitForHealthz } from "./smoke-harness.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const services = ["api", "upload", "content", "jobs", "stream"];
const allocation = JSON.parse(
  execFileSync("sbx-runtime", ["allocate", "--format", "json", ...services.map((s) => `transfer-${s}`)], {
    cwd: root,
    encoding: "utf8",
  }),
);
const output = await mkdtemp(path.join(allocation.state_dir, "local-transfers-"));
const urls = {};
for (const service of services) {
  const port = allocation.ports[`transfer-${service}`];
  process.env[`AGENT_PASTE_LOCAL_${service.toUpperCase()}_PORT`] = String(port);
  urls[service] = `http://127.0.0.1:${port}`;
}
process.env.AGENT_PASTE_LOCAL_DATABASE_BACKEND = "memory";
process.env.AGENT_PASTE_LOCAL_CAPABILITY_DOMAIN = "transfers.test";
process.env.AGENT_PASTE_LOCAL_CAPABILITY_PROXY = urls.content;
process.env.SMOKE_HARNESS_SECRET = randomBytes(32).toString("base64url");
const proxyPath = fileURLToPath(new URL("./local-transfer-proxy.mjs", import.meta.url));
await import("./local-transfer-proxy.mjs");
const { localHarness } = await import("./local-mvp-server.mjs");
const evidence = {
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  checks: [],
};
let soakChild;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => soakChild?.kill("SIGTERM"));
try {
  await waitForHealthz(urls.api, { timeoutMs: 10000, sleepMs: 100 });
  const provisioned = await provisionSmokeWorkspace(urls.api, {
    email: `transfers-${Date.now()}@example.test`,
    name: "Local transfers",
    secret: process.env.SMOKE_HARNESS_SECRET,
  });
  assert(provisioned.api_key?.secret);
  const env = {
    ...process.env,
    AGENT_PASTE_API_KEY: provisioned.api_key.secret,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${proxyPath}`.trim(),
  };
  const { localTransferAcceptance } = await import("./local-transfer-acceptance.mjs");
  evidence.checks = await localTransferAcceptance({ localHarness, urls, provisioned });
  if (!process.argv.includes("--fixtures-only")) {
    const child = spawn(
      process.execPath,
      ["scripts/transfer-soak.mjs", "--api", urls.api, "--upload", urls.upload, "--output", output],
      { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    soakChild = child;
    let stderr = "";
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    await writeFile(path.join(output, "private-soak-stderr.log"), stderr, { mode: 0o600 });
    assert.equal(code, 0, "Transfer soak failed; private diagnostics remain in the output directory");
    const report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
    evidence.soak = {
      checks: report.checks,
      runs: report.runs.length,
      peak_cli_rss_kib: Math.max(...report.runs.map((r) => r.peak_rss_kib)),
    };
  }
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  // Assertions may contain signed URLs. Keep full diagnostics private.
  await writeFile(path.join(output, "private-driver-error.log"), String(error?.stack ?? error), { mode: 0o600 });
  process.stderr.write("Local transfer acceptance failed. Inspect the private output directory.\n");
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, "local-evidence.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  for (const server of localHarness.servers) server.closeAllConnections();
  await Promise.all(localHarness.servers.map((server) => new Promise((resolve) => server.close(resolve))));
  console.log(`Local transfer evidence: ${output}`);
}
