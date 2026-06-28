import { USAGE_POLICY as usagePolicy } from "@agent-paste/config";
import { trimTrailingSlashes } from "@agent-paste/contracts";
import { type SqlExecutor, withSqlQuerySource } from "@agent-paste/db";
import { resolveAgentViewTokenSigner } from "@agent-paste/rotation";
import { mintAgentViewUrl, verifyAgentViewToken } from "@agent-paste/tokens/agent-view";
import type { Env } from "../env.js";
import { applyMaliciousUrlLockdown } from "../safety/platform-lockdown.js";
import { scanPublishedUrlMalicious } from "../safety/url-scanner.js";

export async function runEphemeralUrlScanner(
  executor: SqlExecutor,
  env: Env,
  input: {
    workspaceId: string;
    artifactId: string;
    revisionId: string;
    requestedAt: string;
  },
): Promise<void> {
  const apiBase = env.API_BASE_URL ? trimTrailingSlashes(env.API_BASE_URL) : undefined;
  const signer = resolveAgentViewTokenSigner(env);
  if (!apiBase || !signer) {
    return;
  }
  const expiresAt = await loadArtifactExpiresAt(executor, input.workspaceId, input.artifactId);
  const publishedUrl = await mintAgentViewUrl({
    baseUrl: apiBase,
    secret: signer.signingSecret,
    payload: {
      artifact_id: input.artifactId,
      revision_id: input.revisionId,
      exp: agentViewTokenExpiration(expiresAt),
    },
  });
  const token = publishedUrl.split("/v1/public/agent-view/")[1];
  if (!token || !(await verifyAgentViewToken(decodeURIComponent(token), signer.signingSecret))) {
    return;
  }
  const verdict = await scanPublishedUrlMalicious({
    url: publishedUrl,
    ...(env.CLOUDFLARE_ACCOUNT_ID ? { accountId: env.CLOUDFLARE_ACCOUNT_ID } : {}),
    ...(env.URL_SCANNER_API_TOKEN ? { apiToken: env.URL_SCANNER_API_TOKEN } : {}),
  });
  if (verdict !== "malicious") {
    return;
  }
  await applyMaliciousUrlLockdown(executor, env, {
    workspaceId: input.workspaceId,
    artifactId: input.artifactId,
    revisionId: input.revisionId,
    now: input.requestedAt,
  });
}

async function loadArtifactExpiresAt(
  executor: SqlExecutor,
  workspaceId: string,
  artifactId: string,
): Promise<string | undefined> {
  return withSource("loadArtifactExpiresAt", async () => {
    const result = await executor.query<{ expires_at: string }>(
      `select expires_at from artifacts where workspace_id = $1 and id = $2`,
      [workspaceId, artifactId],
    );
    return result.rows[0]?.expires_at;
  });
}

function withSource<T>(functionName: string, run: () => T): T {
  return withSqlQuerySource(
    {
      filepath: "apps/jobs/src/handlers/safety-ephemeral-url-scan.ts",
      functionName,
      namespace: "apps.jobs.src.handlers.safety-ephemeral-url-scan",
    },
    run,
  );
}

function agentViewTokenExpiration(expiresAt: string | undefined): number {
  const parsed = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Math.floor(Date.now() / 1000) + usagePolicy.default_ttl_seconds;
}
