// @ts-check
// Manages local/dev secret values in a gitignored .env file, per ADR 0078.
//
// Local is the one environment where storing values in a readable file is the
// right call: nothing is at risk, dev must be trivial to recreate, and rolling a
// secret is just deleting a line. These values are INDEPENDENT of preview/prod
// (a leaked local value can forge nothing real) and are read by the local dev
// server (scripts/local-mvp-server.mjs).
//
// The function generates only keys that are absent, so re-running never disturbs
// existing local values, and never prints a value.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// The exact env var names the local dev server reads (see local-mvp-server.mjs).
export const LOCAL_SECRET_KEYS = [
  "AGENT_PASTE_API_KEY_PEPPER",
  "AGENT_PASTE_UPLOAD_SIGNING_SECRET",
  "AGENT_PASTE_CONTENT_SIGNING_SECRET",
  "AGENT_PASTE_ARTIFACT_BYTES_ENCRYPTION_KEY",
  "AGENT_PASTE_ACCESS_LINK_SIGNING_KEY",
  "STREAM_INTERNAL_SECRET",
  "EPHEMERAL_POW_SECRET",
  "SMOKE_HARNESS_SECRET",
];

/** Parse `.env` into a name->rawLine ordered map, preserving non-secret lines. */
function readEnv(envPath) {
  if (!existsSync(envPath)) {
    return { keys: new Set(), text: "" };
  }
  const text = readFileSync(envPath, "utf8");
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (match) {
      keys.add(match[1]);
    }
  }
  return { keys, text };
}

/**
 * Ensure every local secret key exists in `.env`, generating only the missing
 * ones. Returns the names that were newly generated (for a value-free log).
 * @param {string} envPath
 * @returns {{ generated: string[], present: string[] }}
 */
export function ensureLocalEnvSecrets(envPath) {
  const { keys, text } = readEnv(envPath);
  const generated = [];
  const present = [];
  let appended = "";
  for (const key of LOCAL_SECRET_KEYS) {
    if (keys.has(key)) {
      present.push(key);
      continue;
    }
    appended += `${key}=${secretBytes()}\n`;
    generated.push(key);
  }
  if (generated.length > 0) {
    const needsNewline = text.length > 0 && !text.endsWith("\n");
    const banner = "\n# agent-paste local secrets (generated; gitignored; safe to delete a line to roll it)\n";
    writeFileSync(envPath, `${text}${needsNewline ? "\n" : ""}${banner}${appended}`);
  }
  return { generated, present };
}

function secretBytes() {
  return randomBytes(48).toString("base64url");
}
