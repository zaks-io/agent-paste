#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const binary = requiredEnv("AGENT_PASTE_RELEASE_BINARY");
requiredEnv("AGENT_PASTE_API_KEY");

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-release-smoke-"));
try {
  const directory = path.join(fixture, "site");
  const entrypoint = "index.html";
  const body = "<!doctype html><title>CLI release smoke</title>\n";
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, entrypoint), body);
  await fs.writeFile(path.join(directory, "data.json"), '{"release_smoke":true}\n');

  const version = await runJson(["version", "--json"]);
  assert(version.schema_version === "2", "release binary reports schema_version 2");

  const whoami = await runJson(["whoami", "--json"]);
  assert(typeof whoami.actor?.id === "string", "release binary authenticates the production smoke key");
  assert(whoami.scopes?.includes("publish"), "production smoke key has publish scope");
  assert(whoami.scopes?.includes("read"), "production smoke key has read scope");

  const directoryPublish = await runJson(["publish", directory, "--title", "CLI release smoke", "--json"]);
  assertPublish(directoryPublish, "signed-in directory publish", "CLI release smoke");

  const pulled = await runJson(["pull", directoryPublish.artifact_id, entrypoint, "--json"]);
  assert(pulled.revision_id === undefined, "pull does not invent a revision id");
  assert(pulled.path === entrypoint, "pull returns the requested path");
  assert(typeof pulled.url === "string" && pulled.url.startsWith("https://"), "pull returns a content URL");
  assert(pulled.body === body, "pull returns the freshly published bytes to the same API-key actor");

  const singleFile = path.join(fixture, "single.txt");
  await fs.writeFile(singleFile, "single-file release smoke\n");
  assertPublish(
    await runJson(["publish", singleFile, "--title", "CLI single-file smoke", "--json"]),
    "signed-in single-file publish",
    "CLI single-file smoke",
  );

  const ephemeral = await runJson(["publish", singleFile, "--ephemeral", "--title", "CLI ephemeral smoke", "--json"]);
  assertPublish(ephemeral, "ephemeral publish", "CLI ephemeral smoke");
  assert(typeof ephemeral.claim_url === "string", "ephemeral publish returns claim_url");
  assert(typeof ephemeral.claim_token === "string", "ephemeral publish returns claim_token");

  process.stdout.write(`CLI ${version.version} release smoke passed against production.\n`);
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}

function assertPublish(value, label, expectedTitle) {
  assert(value.schema_version === "2", `${label} reports schema_version 2`);
  assert(typeof value.artifact_id === "string" && value.artifact_id.startsWith("art_"), `${label} returns artifact_id`);
  assert(typeof value.revision_id === "string" && value.revision_id.startsWith("rev_"), `${label} returns revision_id`);
  assert(value.title === expectedTitle, `${label} returns the requested title`);
  assert(typeof value.url === "string" && value.url.startsWith("https://"), `${label} returns url`);
  assert(typeof value.expires_at === "string", `${label} returns expires_at`);
  assert(value.upload_stats && typeof value.upload_stats === "object", `${label} returns upload_stats`);
  for (const field of [
    "total_files",
    "total_bytes",
    "uploaded_files",
    "uploaded_bytes",
    "reused_files",
    "reused_bytes",
  ]) {
    assert(typeof value.upload_stats[field] === "number", `${label} upload_stats returns ${field}`);
  }
}

async function runJson(args) {
  const { stdout, stderr } = await run(args);
  if (stderr.includes("recovered the exact Artifact URL")) {
    throw new Error(`release binary ${args[0]} needed post-commit recovery; its publish response parser is stale`);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`release binary returned invalid JSON for ${args[0]}`);
  }
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout: stdout.trim(), stderr });
      else reject(new Error(`release binary ${args[0]} exited ${code}: ${stderr.trim() || "no diagnostic"}`));
    });
  });
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
