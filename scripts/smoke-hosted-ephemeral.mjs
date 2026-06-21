#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mintForPrefix } from "./lib/workos-m2m.mjs";
import {
  assertAgentView,
  assertClaimRedemption,
  assertContentPolicy,
  assertEphemeralWriteAllowance,
  assertNoClaimTokenLeakage,
  assertPublishOutput,
  classifyCliFailure,
  EPHEMERAL_SITE_DIR,
  EphemeralSmokeError,
  ephemeralHostedConfig,
  normalizeEphemeralHostedTarget,
  probeEphemeralProvisionReady,
  shouldFailHostedEphemeralReadiness,
  toBoundaryError,
} from "./smoke-ephemeral-harness.mjs";
import { deleteSmokeArtifact, waitForHealthz } from "./smoke-harness.mjs";

loadDotenv();
const root = fileURLToPath(new URL("..", import.meta.url));
const cliEntry = fileURLToPath(new URL("../apps/cli/dist/index.js", import.meta.url));
const target = normalizeEphemeralHostedTarget(process.argv[2] ?? "preview");
const config = ephemeralHostedConfig(target);

try {
  await runHostedEphemeralSmoke();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${config.label} ephemeral hosted smoke failed: ${message}\n`);
  process.exitCode = 1;
}

async function runHostedEphemeralSmoke() {
  if (process.env.AGENT_PASTE_SKIP_EPHEMERAL_SMOKE === "1") {
    skipHostedEphemeral("AGENT_PASTE_SKIP_EPHEMERAL_SMOKE=1");
  }

  await waitForHealthz(config.apiBaseUrl);
  const readiness = await probeEphemeralProvisionReady(config.apiBaseUrl);
  if (!readiness.ready) {
    if (shouldFailHostedEphemeralReadiness(readiness)) {
      throw new EphemeralSmokeError("provision", readiness.reason ?? "ephemeral provision probe was not ready");
    }
    skipHostedEphemeral(readiness.reason);
  }

  const claimWebOrigin = config.webBaseUrl.replace(/\/+$/, "");
  const artifactWebOrigin = target === "pr" && !process.env.AGENT_PASTE_PR_WEB_URL ? undefined : claimWebOrigin;
  const cliEnv = {
    ...process.env,
    AGENT_PASTE_API_URL: config.apiBaseUrl,
    AGENT_PASTE_UPLOAD_URL: config.uploadBaseUrl,
    AGENT_PASTE_WEB_URL: claimWebOrigin,
  };
  delete cliEnv.AGENT_PASTE_API_KEY;

  // Per ADR 0078: mint a fresh WorkOS access token at run time via M2M
  // client_credentials so the token can never go stale. Fall back to a
  // pre-provided token only if M2M is not configured.
  const workosAccessToken = await resolveClaimToken();
  let claimSummary = workosAccessToken
    ? "Claim redemption attempted with a run-time WorkOS token."
    : "Claim redemption skipped (configure AGENT_PASTE_EPHEMERAL_SMOKE_WORKOS_M2M_* to enable).";
  let memberAuth;
  let memberWorkspaceId;
  if (config.allowClaim && workosAccessToken) {
    memberAuth = { authorization: `Bearer ${workosAccessToken}` };
    const callback = await fetchJson(`${config.apiBaseUrl}/v1/auth/web/callback`, {
      method: "POST",
      headers: memberAuth,
      boundary: "claim",
    });
    if (!callback.workspace?.id) {
      throw new EphemeralSmokeError("claim", "web callback did not return workspace id");
    }
    memberWorkspaceId = callback.workspace.id;
    claimSummary = `Claim redemption passed (member workspace ${memberWorkspaceId}).`;
  }

  try {
    await assertEphemeralWriteAllowance(config.apiBaseUrl);
  } catch (error) {
    throw toBoundaryError("policy", error);
  }

  let published;
  let stderrOutput = "";
  try {
    const { stdout, stderr } = await runCli(
      ["publish", EPHEMERAL_SITE_DIR, "--ephemeral", "--title", `${config.label} ephemeral smoke`, "--json"],
      cliEnv,
    );
    stderrOutput = stderr;
    published = JSON.parse(stdout);
  } catch (error) {
    throw toBoundaryError(classifyCliFailure(error), error);
  }

  assertNoClaimTokenLeakage(published, stderrOutput);
  await assertPublishOutput(published, {
    apiBaseUrl: config.apiBaseUrl,
    contentBaseUrl: config.contentBaseUrl,
    webBaseUrl: artifactWebOrigin,
    claimWebOrigin,
    expectedClaimTokenPrefix: config.expectedClaimTokenPrefix,
  });
  await assertContentPolicy(published.revision_content_url, published.claim_token);
  await assertAgentView(published, {
    apiBaseUrl: config.apiBaseUrl,
    contentBaseUrl: config.contentBaseUrl,
  });

  if (memberAuth && memberWorkspaceId) {
    await assertClaimRedemption({
      apiBaseUrl: config.apiBaseUrl,
      memberAuth,
      memberWorkspaceId,
      published,
    });
  }

  let cleanupSummary = "Cleanup skipped (ephemeral content expires on the 24h auto-deletion schedule).";
  if (config.allowHarnessCleanup && config.harnessSecret) {
    await deleteSmokeArtifact(config.apiBaseUrl, published.artifact_id, config.harnessSecret);
    cleanupSummary = `Deleted smoke artifact ${published.artifact_id} via harness route.`;
  } else if (config.allowHarnessCleanup) {
    cleanupSummary = "Cleanup skipped (smoke harness secret not configured).";
  }

  process.stdout.write(`${config.label} ephemeral hosted smoke passed.

Environment:  ${target}
Artifact:     ${published.artifact_id}
Workspace:    ${published.workspace_id}
Share URL:    ${published.unlisted_url}
Revision URL: ${published.revision_content_url}
Agent View:   ${published.agent_view_url}
Claim URL:    ${published.claim_url.replace(/#.*$/, "#<redacted>")}
Provision:    rate limits and provision wait accepted the request
Policy:       script-disabled CSP, noindex, ephemeral write allowance
${claimSummary}
${cleanupSummary}
`);
}

function skipHostedEphemeral(reason) {
  process.stdout.write(`${config.label} ephemeral hosted smoke skipped: ${reason}\n`);
  process.exit(0);
}

function runCli(args, commandEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: root,
      env: commandEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr });
      } else {
        reject(new Error(`CLI exited ${code}\n${stderr || stdout}`));
      }
    });
  });
}

async function fetchJson(url, { boundary = "content", ...init } = {}) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new EphemeralSmokeError(boundary, `${url} returned ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

// Obtain a WorkOS access token for claim redemption: mint a fresh one via M2M
// client_credentials (ADR 0078), or fall back to a pre-provided token if one is
// still configured. Returns undefined when neither is available so claim skips.
async function resolveClaimToken() {
  const minted = await mintForPrefix("AGENT_PASTE_EPHEMERAL_SMOKE");
  if (minted.token) {
    return minted.token;
  }
  return process.env.AGENT_PASTE_EPHEMERAL_SMOKE_WORKOS_ACCESS_TOKEN || undefined;
}

function loadDotenv() {
  if (!existsSync(".env")) {
    return;
  }
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = unquote(rawValue);
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
