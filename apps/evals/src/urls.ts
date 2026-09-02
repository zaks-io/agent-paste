export type ClassifiedUrls = {
  artifact?: string;
  claim?: string;
  production: string[];
  all: string[];
};

const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]{}|\\^`*]+/g;
const PRODUCTION_ARTIFACT_HOST = /^[0-9a-f]{32}\.agent-paste\.link$/;
const PREVIEW_ARTIFACT_HOST =
  /^[0-9a-f]{32}-(?:(?:preview|pr-[1-9][0-9]*)\.agent-paste\.link|preview\.agent-paste\.sh)$/;

export function classifyUrls(text: string): ClassifiedUrls {
  const urls = Array.from(new Set(text.match(URL_PATTERN) ?? [])).map(cleanUrl);
  const classified: ClassifiedUrls = { production: [], all: urls };
  for (const url of urls) {
    const parsed = parseUrl(url);
    if (!parsed) {
      continue;
    }
    if (isProductionAgentPasteHost(parsed.hostname)) {
      classified.production.push(url);
    }
    if (isArtifactHost(parsed.hostname)) {
      classified.artifact ??= url;
    } else if (parsed.hostname.startsWith("app.") && parsed.pathname === "/claim") {
      classified.claim ??= url;
    }
  }
  return classified;
}

export function isProductionArtifactHost(hostname: string): boolean {
  return PRODUCTION_ARTIFACT_HOST.test(hostname);
}

export function isPreviewArtifactHost(hostname: string): boolean {
  return PREVIEW_ARTIFACT_HOST.test(hostname);
}

function cleanUrl(url: string): string {
  const trimmed = url.replace(/[\\.,;:!?*_]+$/g, "");
  const parsed = parseUrl(trimmed);
  if (!parsed) {
    return trimmed;
  }
  if (parsed.hostname.startsWith("app.") && parsed.hash) {
    parsed.hash = parsed.hash.match(/^#[A-Za-z0-9._-]+/)?.[0] ?? "";
  }
  return parsed.toString();
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isArtifactHost(hostname: string): boolean {
  return isProductionArtifactHost(hostname) || isPreviewArtifactHost(hostname);
}

function isProductionAgentPasteHost(hostname: string): boolean {
  if (hostname === "agent-paste.sh" || hostname === "agent-paste.link") {
    return true;
  }
  return (
    (hostname.endsWith(".agent-paste.sh") || hostname.endsWith(".agent-paste.link")) &&
    !isPreviewAgentPasteHost(hostname)
  );
}

function isPreviewAgentPasteHost(hostname: string): boolean {
  return (
    hostname === "preview.agent-paste.sh" ||
    hostname === "preview.agent-paste.link" ||
    hostname.endsWith(".preview.agent-paste.sh") ||
    hostname.endsWith(".preview.agent-paste.link") ||
    isPreviewArtifactHost(hostname)
  );
}
