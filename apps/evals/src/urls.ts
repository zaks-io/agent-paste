export type ClassifiedUrls = {
  unlisted?: string;
  claim?: string;
  private?: string;
  revisionContent?: string;
  production: string[];
  all: string[];
};

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

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
    if (parsed.hostname.startsWith("app.") && parsed.pathname.startsWith("/al/")) {
      classified.unlisted ??= url;
    } else if (parsed.hostname.startsWith("app.") && parsed.pathname === "/claim") {
      classified.claim ??= url;
    } else if (parsed.hostname.startsWith("app.") && parsed.pathname.startsWith("/v/")) {
      classified.private ??= url;
    } else if (parsed.hostname.startsWith("usercontent.") && parsed.pathname.startsWith("/v/")) {
      classified.revisionContent ??= url;
    }
  }
  return classified;
}

function cleanUrl(url: string): string {
  return url.replace(/[\\.,;:!?]+$/g, "");
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isProductionAgentPasteHost(hostname: string): boolean {
  if (hostname === "agent-paste.sh") {
    return true;
  }
  return hostname.endsWith(".agent-paste.sh") && !isPreviewAgentPasteHost(hostname);
}

function isPreviewAgentPasteHost(hostname: string): boolean {
  return hostname === "preview.agent-paste.sh" || hostname.endsWith(".preview.agent-paste.sh");
}
