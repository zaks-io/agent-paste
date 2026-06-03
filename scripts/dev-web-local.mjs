#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { waitForHealthz } from "./smoke-harness.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const serverEntry = fileURLToPath(new URL("./local-mvp-server.mjs", import.meta.url));
const webPort = process.env.AGENT_PASTE_LOCAL_WEB_PORT ?? "5173";
const apiPort = process.env.AGENT_PASTE_LOCAL_API_PORT ?? "8787";
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const webBaseUrl = `http://localhost:${webPort}`;
const children = new Map();
let shuttingDown = false;

try {
  await runStep("build", "pnpm", ["build"]);

  const api = startChild("api", process.execPath, [serverEntry]);
  await waitForHealthz(apiBaseUrl, { timeoutMs: 30_000, sleepMs: 250 });

  const web = startChild("web", "pnpm", [
    "--filter",
    "@agent-paste/web",
    "dev",
    "--",
    "--host",
    "0.0.0.0",
    "--port",
    webPort,
    "--strictPort",
  ]);
  await waitForHealthz(webBaseUrl, { timeoutMs: 60_000, sleepMs: 500 });

  process.stdout.write(`agent-paste web dev ready

  Web: ${webBaseUrl}
  API: ${apiBaseUrl}

Press Ctrl-C to stop both.

`);

  const { label, code, signal } = await waitForAnyExit([api, web]);
  throw new Error(`${label} exited ${signal ?? code}`);
} catch (error) {
  if (!shuttingDown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`agent-paste web dev failed: ${message}\n`);
    await shutdown(1);
  }
}

function startChild(label, command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  children.set(child, label);
  child.on("error", (error) => {
    process.stderr.write(`agent-paste ${label} failed to start: ${error.message}\n`);
  });
  return child;
}

async function runStep(label, command, args) {
  const child = startChild(label, command, args);
  const [code, signal] = await once(child, "exit");
  children.delete(child);
  if (code !== 0) {
    throw new Error(`${label} exited ${signal ?? code}`);
  }
}

function waitForAnyExit(targets) {
  return Promise.race(
    targets.map(async (child) => {
      const [code, signal] = await once(child, "exit");
      const label = children.get(child) ?? "child";
      children.delete(child);
      return { label, code, signal };
    }),
  );
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children.keys()) {
    child.kill("SIGTERM");
  }
  await Promise.allSettled([...children.keys()].map((child) => once(child, "exit")));
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(0);
  });
}
