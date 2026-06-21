import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { findSensitiveText } from "./redaction";
import type { EvalConfig, VerifierResult } from "./types";
import { classifyUrls } from "./urls";

export async function verifyRunOutput(params: {
  config: EvalConfig;
  text: string;
  outputDir: string;
}): Promise<VerifierResult> {
  const urls = classifyUrls(params.text);
  const sourceProduction = groupProductionUrls(urls.production);
  const sourceSecrets = findSensitiveText(params.text);
  const result: VerifierResult = {
    passed: false,
    ...(urls.unlisted ? { unlisted_url: urls.unlisted } : {}),
    ...(urls.claim ? { claim_url: urls.claim } : {}),
    ...(urls.private ? { private_url: urls.private } : {}),
    ...(urls.revisionContent ? { revision_content_url: urls.revisionContent } : {}),
    production_url_detected: urls.production.length > 0,
    production_doc_url_detected: sourceProduction.docs.length > 0,
    production_handoff_url_detected: sourceProduction.handoff.length > 0,
    production_artifact_url_detected: false,
    production_url_details: {
      docs: sourceProduction.docs,
      handoff: sourceProduction.handoff,
      other: sourceProduction.other,
      artifact: [],
    },
    secret_detected: sourceSecrets.length > 0,
    secret_sources: sourceSecrets.map((match) => `transcript:${match}`),
    warnings: [],
    errors: [],
  };

  if (params.config.environment.reject_production_urls) {
    if (sourceProduction.handoff.length > 0) {
      result.warnings.push("production_handoff_url_detected");
    }
    if (sourceProduction.other.length > 0) {
      result.warnings.push("production_url_detected");
    }
  }
  if (sourceSecrets.length > 0) {
    result.warnings.push("secret_detected:transcript");
  }
  result.errors.push(...handoffEnvironmentErrors(params.config, urls.all));
  if (params.config.verification.require_unlisted_url && !urls.unlisted) {
    result.errors.push("missing_unlisted_url");
    return result;
  }
  if (!urls.unlisted) {
    return result;
  }
  if (result.errors.length > 0) {
    return result;
  }

  const response = await fetch(urls.unlisted, { redirect: "follow" });
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
  result.production_url_detected ||= artifactUrls.production.length > 0;
  result.production_doc_url_detected ||= artifactProduction.docs.length > 0;
  result.production_handoff_url_detected ||= artifactProduction.handoff.length > 0;
  result.production_url_details.docs = unique([...result.production_url_details.docs, ...artifactProduction.docs]);
  result.production_url_details.handoff = unique([
    ...result.production_url_details.handoff,
    ...artifactProduction.handoff,
  ]);
  result.production_url_details.other = unique([...result.production_url_details.other, ...artifactProduction.other]);

  if (config.environment.reject_production_urls && relevantProduction.length > 0) {
    result.warnings.push("production_artifact_url_detected");
  }

  const artifactSecrets = findSensitiveText(artifact);
  if (artifactSecrets.length > 0) {
    result.secret_detected = true;
    result.secret_sources = unique([...result.secret_sources, ...artifactSecrets.map((match) => `artifact:${match}`)]);
    result.warnings.push("secret_detected:artifact");
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
