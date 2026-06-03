#!/usr/bin/env node

import { setTimeout as delay } from "node:timers/promises";

/** Fail-fast HTTP listen helpers for local smoke harnesses. */

export const LOCAL_MVP_READY_MARKER = "agent-paste local MVP running";

/**
 * @param {number} port
 * @param {string} envVar
 * @param {string} [label]
 */
export function formatPortInUseError(port, envVar, label = "server") {
  return (
    `Port ${port} is already in use (${label} on 127.0.0.1:${port}). ` +
    `Set ${envVar} to a free port and retry.`
  );
}

/**
 * @param {import("node:http").Server} server
 * @param {number} port
 * @param {{ envVar: string, label?: string }} options
 */
export function listenHttpPort(server, port, { envVar, label = "server" }) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      cleanup();
      if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
        reject(new Error(formatPortInUseError(port, envVar, label)));
        return;
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const onListening = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Wait for spawned harness health checks while failing fast if the child exits or logs EADDRINUSE.
 *
 * @param {import("node:child_process").ChildProcess} child
 * @param {string[]} healthBaseUrls
 * @param {{ getLog?: () => string, timeoutMs?: number, sleepMs?: number }} [options]
 * @param {(baseUrl: string, opts: object) => Promise<void>} waitForHealthz
 */
export async function waitForHarnessHealth(child, healthBaseUrls, options, waitForHealthz) {
  const getLog = options.getLog ?? (() => "");
  const timeoutMs = options.timeoutMs ?? 10_000;
  const readyPattern = options.readyPattern ?? new RegExp(LOCAL_MVP_READY_MARKER);
  const healthOptions = { timeoutMs, sleepMs: options.sleepMs ?? 100 };

  await waitForHarnessStartup(child, getLog, { readyPattern, timeoutMs });

  await Promise.all(healthBaseUrls.map((baseUrl) => waitForHealthz(baseUrl, healthOptions)));
}

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {() => string} getLog
 * @param {{ readyPattern: RegExp, timeoutMs: number }} options
 */
async function waitForHarnessStartup(child, getLog, { readyPattern, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const log = getLog();
    const portError = extractPortInUseFromHarnessLog(log);
    if (portError) {
      throw portError;
    }
    if (readyPattern.test(log)) {
      return;
    }
    if (child.exitCode !== null && child.exitCode !== 0) {
      const fromLog = extractPortInUseFromHarnessLog(log);
      if (fromLog) {
        throw fromLog;
      }
      throw new Error(
        `Local harness process exited with code ${child.exitCode}${log.trim() ? `:\n${log.trim()}` : ""}`,
      );
    }
    await delay(50);
  }

  const log = getLog();
  const portError = extractPortInUseFromHarnessLog(log);
  if (portError) {
    throw portError;
  }
  throw new Error(
    `Local harness did not become ready within ${timeoutMs}ms${log.trim() ? `:\n${log.trim()}` : ""}`,
  );
}

/**
 * @param {string} log
 * @returns {Error | undefined}
 */
export function extractPortInUseFromHarnessLog(log) {
  if (!log.includes("EADDRINUSE") && !log.includes("already in use")) {
    return undefined;
  }

  const harnessMatch = log.match(/agent-paste local harness failed: (.+)/);
  if (harnessMatch) {
    return new Error(harnessMatch[1].trim());
  }

  const legacyMatch = log.match(
    /agent-paste local (\w+) server failed on port (\d+):.*EADDRINUSE/i,
  );
  if (legacyMatch) {
    const envVar = LOCAL_SERVER_PORT_ENV[legacyMatch[1]] ?? "AGENT_PASTE_LOCAL_API_PORT";
    return new Error(formatPortInUseError(Number(legacyMatch[2]), envVar, `${legacyMatch[1]} server`));
  }

  const genericMatch = log.match(/127\.0\.0\.1:(\d+).*EADDRINUSE/i);
  if (genericMatch) {
    return new Error(`Port ${genericMatch[1]} is already in use. Check harness output for the override env var.`);
  }

  return undefined;
}

/** @type {Record<string, string>} */
export const LOCAL_SERVER_PORT_ENV = {
  api: "AGENT_PASTE_LOCAL_API_PORT",
  upload: "AGENT_PASTE_LOCAL_UPLOAD_PORT",
  content: "AGENT_PASTE_LOCAL_CONTENT_PORT",
  jobs: "AGENT_PASTE_LOCAL_JOBS_PORT",
  stream: "AGENT_PASTE_LOCAL_STREAM_PORT",
};
