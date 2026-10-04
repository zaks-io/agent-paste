#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnvFiles } from "./lib/load-env-files.mjs";
import { provisionSmokeWorkspace, deleteSmokeArtifact, listR2Keys } from "./smoke-harness.mjs";
import { mcpInitializeSession, mcpToolsList, mcpCallTool } from "./smoke-mcp-harness.mjs";

const directory = resolve(".wrangler/local-cloudflare");
const api = "http://127.0.0.1:8787";
const local = {};
loadEnvFiles([resolve(directory, ".env")], { env: local });
assert(local.SMOKE_HARNESS_SECRET, "Run pnpm dev:cloudflare first.");
const auth = JSON.parse(await readFile(resolve(directory, "auth.json"), "utf8"));
const testDirectory = await mkdtemp(resolve(directory, "smoke-"));
const provisioned = await provisionSmokeWorkspace(api, {
  email: `cloudflare-${Date.now()}@example.test`,
  name: "Local Cloudflare smoke",
  secret: local.SMOKE_HARNESS_SECRET,
});
const env = {
  ...process.env,
  AGENT_PASTE_API_URL: api,
  AGENT_PASTE_UPLOAD_URL: "http://127.0.0.1:8788",
  AGENT_PASTE_API_KEY: provisioned.api_key.secret,
  XDG_CONFIG_HOME: resolve(testDirectory, "config"),
};

function cli(args, overrides = {}) {
  try {
    return JSON.parse(
      execFileSync(process.execPath, ["apps/cli/dist/index.js", ...args, "--json"], {
        env: { ...env, ...overrides },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 90000,
      }),
    );
  } catch {
    throw new Error(`Local CLI ${args[0]} failed; no credential or bearer URL output was logged.`);
  }
}

assert.equal(cli(["whoami"]).workspace.id, provisioned.workspace.id);
const first = cli(["publish", "examples/local-harness/site"]);
const content = await fetch(first.url);
assert.equal(content.status, 200);
assert.match(await content.text(), /Agent Paste Local/);
assert.equal(content.headers.get("x-frame-options"), "DENY");
assert.match(content.headers.get("content-security-policy"), /frame-ancestors 'none'/);
const downloaded = cli(["download", first.artifact_id, "--output", resolve(testDirectory, "bundle.zip")]);
const zip = await readFile(resolve(testDirectory, "bundle.zip"));
assert.equal(downloaded.size_bytes, zip.length);
assert.equal(zip.subarray(0, 4).toString("hex"), "504b0304");
console.log("PASS CLI auth, encrypted R2 publish/read, security headers, queue-generated bundle download");

await writeFile(resolve(testDirectory, "index.html"), "<!doctype html><h1>Local Cloudflare revision two</h1>");
const second = cli(["publish", resolve(testDirectory, "index.html"), "--artifact-id", first.artifact_id]);
assert.equal(second.artifact_id, first.artifact_id);
assert.notEqual(second.revision_id, first.revision_id);
assert.match(await (await fetch(second.url)).text(), /revision two/);
await deleteSmokeArtifact(api, first.artifact_id, local.SMOKE_HARNESS_SECRET);
assert.equal((await fetch(second.url)).status, 404);
for (let attempt = 0; attempt < 50; attempt++) {
  const keys = await listR2Keys(api, `artifacts/${first.artifact_id}/`, local.SMOKE_HARNESS_SECRET);
  if (keys.length === 0) break;
  assert(attempt < 49, "Local byte-purge queue did not remove the deleted Artifact's objects.");
  await delay(100);
}
console.log("PASS revise, shared denylist invalidation, queue-driven byte purge");

const ephemeral = cli(["publish", "examples/local-harness/ephemeral-site", "--ephemeral"], { AGENT_PASTE_API_KEY: "" });
const restricted = await fetch(ephemeral.url);
assert.equal(restricted.status, 200);
assert.match(restricted.headers.get("content-security-policy"), /script-src 'none'/);
assert.match(restricted.headers.get("content-security-policy"), /connect-src 'none'/);
assert(!(await restricted.text()).includes(ephemeral.claim_token));
const claimed = await fetch(`${api}/v1/ephemeral/claim`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${auth.accessToken}`,
    "content-type": "application/json",
    "idempotency-key": crypto.randomUUID(),
  },
  body: JSON.stringify({ claim_token: ephemeral.claim_token }),
});
assert.equal(claimed.status, 200);
const owned = await fetch(`${api}/v1/web/artifacts`, { headers: { authorization: `Bearer ${auth.accessToken}` } });
assert.equal(owned.status, 200);
assert((await owned.json()).items.some((artifact) => artifact.id === ephemeral.artifact_id));
await deleteSmokeArtifact(api, ephemeral.artifact_id, local.SMOKE_HARNESS_SECRET);
console.log("PASS ephemeral provisioning, native Durable Objects, restricted CSP, local WorkOS claim");

const mcp = "http://127.0.0.1:8792";
const rpcId = Date.now();
assert.equal((await fetch(mcp, { method: "POST" })).status, 401);
await mcpInitializeSession(mcp, auth.mcpToken);
assert.equal((await mcpToolsList(mcp, auth.mcpToken)).length, 10);
const published = await mcpCallTool(
  mcp,
  auth.mcpToken,
  "publish_artifact",
  {
    title: "Local MCP proof",
    body: "<!doctype html><h1>Local MCP proof</h1>",
    render_mode: "html",
  },
  rpcId,
);
assert.equal((await fetch(published.url)).status, 200);
await mcpCallTool(mcp, auth.mcpToken, "delete_artifact", { artifact_id: published.artifact_id }, rpcId + 1);
assert.equal((await fetch(published.url)).status, 404);
console.log("PASS MCP OAuth verification and named Worker RPC publish/delete");

const signIn = await fetch("http://127.0.0.1:5173/api/auth/sign-in", { redirect: "manual" });
assert.equal(signIn.status, 302);
const cookie = signIn.headers.get("set-cookie").split(";")[0];
const dashboard = await fetch("http://127.0.0.1:5173/dashboard", { headers: { cookie } });
assert.equal(dashboard.status, 200);
const html = await dashboard.text();
const css = html.match(/href="([^"\s]+\.css)"/)[1];
assert.equal((await fetch(new URL(css, "http://127.0.0.1:5173"))).status, 200);
assert.equal((await fetch("http://127.0.0.1:5174/")).status, 200);
console.log("PASS authenticated dashboard, Cloudflare static assets, marketing Worker");
let limited = false;
let allowed = 0;
const limitCheckStarted = Date.now();
// Two windows cover a burst that begins just before the native window resets.
for (let request = 0; request < 125; request++) {
  const response = await fetch(`${api}/v1/artifacts`, {
    headers: { authorization: `Bearer ${provisioned.api_key.secret}` },
  });
  if (response.status === 429) {
    assert.equal((await response.json()).error.code, "rate_limited_actor");
    limited = true;
    break;
  }
  assert.equal(response.status, 200);
  allowed++;
}
assert(Date.now() - limitCheckStarted < 60000, "Rate-limit burst crossed more than two native windows.");
assert(allowed > 0, "Native rate limiter rejected every request.");
assert(limited, "Native actor rate limiting did not enforce the configured limit.");
console.log("PASS native rate-limit enforcement");
console.log("Local Cloudflare smoke passed.");
