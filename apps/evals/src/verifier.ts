import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvalConfig, VerifierResult } from "./types";
import { classifyUrls } from "./urls";

export async function verifyRunOutput(params: {
  config: EvalConfig;
  finalAnswer?: string | undefined;
  text: string;
  outputDir: string;
}): Promise<VerifierResult> {
  const finalAnswerUrls = classifyUrls(params.finalAnswer ?? "");
  const urls = classifyUrls(params.text);
  const unlistedUrl = finalAnswerUrls.unlisted ?? urls.unlisted;
  const sourceProduction = groupProductionUrls(urls.production);
  const result: VerifierResult = {
    passed: false,
    ...(unlistedUrl ? { unlisted_url: unlistedUrl } : {}),
    ...(urls.claim ? { claim_url: urls.claim } : {}),
    ...(urls.private ? { private_url: urls.private } : {}),
    ...(urls.revisionContent ? { revision_content_url: urls.revisionContent } : {}),
    production_handoff_url_detected: sourceProduction.handoff.length > 0,
    production_artifact_url_detected: false,
    production_url_details: {
      handoff: sourceProduction.handoff,
      artifact: [],
    },
    warnings: [],
    errors: [],
  };

  if (params.config.environment.reject_production_urls) {
    if (sourceProduction.handoff.length > 0) {
      result.warnings.push("production_handoff_url_detected");
    }
  }
  result.errors.push(...handoffEnvironmentErrors(params.config, urls.all));
  if (params.config.verification.require_final_answer_url && !finalAnswerUrls.unlisted) {
    result.errors.push("missing_final_answer_unlisted_url");
  }
  if (params.config.verification.require_unlisted_url && !unlistedUrl) {
    result.errors.push("missing_unlisted_url");
    return result;
  }
  if (!unlistedUrl) {
    result.passed = result.errors.length === 0;
    return result;
  }
  if (result.errors.length > 0) {
    return result;
  }
  const hostError = unlistedUrlHostError(params.config, unlistedUrl);
  if (hostError) {
    result.errors.push(hostError);
    return result;
  }

  const response = await fetch(unlistedUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(params.config.timeouts.verification_timeout_ms),
  });
  result.status = response.status;
  const artifact = await response.text();
  if (params.config.verification.fetch_artifact_snapshot) {
    await mkdir(params.outputDir, { recursive: true });
    await writeFile(path.join(params.outputDir, "artifact-snapshot.html"), artifact);
  }
  attachArtifactChecks(result, params.config, artifact);
  if (response.status !== params.config.verification.require_http_status) {
    result.errors.push(`unexpected_http_status:${response.status}`);
  }
  result.passed = result.errors.length === 0;
  return result;
}

type ProductionUrlGroups = {
  docs: string[];
  handoff: string[];
  other: string[];
};

function attachArtifactChecks(result: VerifierResult, config: EvalConfig, artifact: string): void {
  const artifactUrls = classifyUrls(artifact);
  const artifactProduction = groupProductionUrls(artifactUrls.production);
  const relevantProduction = [...artifactProduction.handoff, ...artifactProduction.other];
  result.production_artifact_url_detected = relevantProduction.length > 0;
  result.production_url_details.artifact = relevantProduction;
  result.production_handoff_url_detected ||= artifactProduction.handoff.length > 0;
  result.production_url_details.handoff = unique([
    ...result.production_url_details.handoff,
    ...artifactProduction.handoff,
  ]);

  if (config.environment.reject_production_urls && relevantProduction.length > 0) {
    result.warnings.push("production_artifact_url_detected");
  }
}

function groupProductionUrls(urls: string[]): ProductionUrlGroups {
  const groups: ProductionUrlGroups = { docs: [], handoff: [], other: [] };
  for (const url of urls) {
    const parsed = parseUrl(url);
    if (!parsed) {
      continue;
    }
    if (isAgentPasteDocsUrl(parsed)) {
      groups.docs.push(url);
    } else if (isAgentPasteWebHandoffUrl(parsed)) {
      groups.handoff.push(url);
    } else {
      groups.other.push(url);
    }
  }
  return groups;
}

function handoffEnvironmentErrors(config: EvalConfig, urls: string[]): string[] {
  const expectedWebHost = hostFromUrl(config.environment.env.AGENT_PASTE_WEB_URL);
  if (!expectedWebHost) {
    return [];
  }

  const errors = new Set<string>();
  for (const url of urls) {
    const parsed = parseUrl(url);
    if (!parsed || !isAgentPasteWebHandoffUrl(parsed)) {
      continue;
    }
    if (parsed.hostname !== expectedWebHost) {
      errors.add(`wrong_environment_url:${parsed.hostname}`);
    }
  }
  return Array.from(errors);
}

function unlistedUrlHostError(config: EvalConfig, url: string): string | undefined {
  const parsed = parseUrl(url);
  if (!parsed) {
    return `invalid_unlisted_url:${url}`;
  }
  const expectedWebHost = hostFromUrl(config.environment.env.AGENT_PASTE_WEB_URL);
  if (expectedWebHost) {
    return parsed.hostname === expectedWebHost ? undefined : `wrong_environment_url:${parsed.hostname}`;
  }
  return isAllowedAgentPasteDomain(parsed.hostname) ? undefined : `unallowed_unlisted_url_host:${parsed.hostname}`;
}

function isAllowedAgentPasteDomain(hostname: string): boolean {
  return hostname === "agent-paste.sh" || hostname.endsWith(".agent-paste.sh");
}

function isAgentPasteDocsUrl(url: URL): boolean {
  return (
    url.hostname === "agent-paste.sh" &&
    (url.pathname === "/agents.md" ||
      url.pathname === "/docs" ||
      url.pathname === "/docs.md" ||
      url.pathname.startsWith("/docs/") ||
      url.pathname === "/llms.txt" ||
      url.pathname === "/llms-full.txt" ||
      url.pathname === "/install.sh" ||
      url.pathname === "/install.ps1")
  );
}

function isAgentPasteWebHandoffUrl(url: URL): boolean {
  return (
    url.hostname.startsWith("app.") &&
    (url.pathname.startsWith("/al/") || url.pathname === "/claim" || url.pathname.startsWith("/v/"))
  );
}

function hostFromUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return parseUrl(value)?.hostname;
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
