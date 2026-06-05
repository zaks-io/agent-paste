import { ARTIFACT_MODEL_DOC } from "./pages/artifact-model.js";
import { BILLING_DOC } from "./pages/billing.js";
import { CLI_DOC } from "./pages/cli.js";
import { DASHBOARD_DOC } from "./pages/dashboard.js";
import { EPHEMERAL_DOC } from "./pages/ephemeral.js";
import { GETTING_STARTED_DOC } from "./pages/getting-started.js";
import { LIMITS_DOC } from "./pages/limits.js";
import { MCP_DOC } from "./pages/mcp.js";
import { REST_API_DOC } from "./pages/rest-api.js";
import { SAFETY_DOC } from "./pages/safety.js";
import { SHARING_DOC } from "./pages/sharing.js";
import type { DocsPage } from "./types.js";

export const DOCS_PAGES = [
  GETTING_STARTED_DOC,
  CLI_DOC,
  ARTIFACT_MODEL_DOC,
  SHARING_DOC,
  EPHEMERAL_DOC,
  DASHBOARD_DOC,
  BILLING_DOC,
  REST_API_DOC,
  MCP_DOC,
  LIMITS_DOC,
  SAFETY_DOC,
] as const satisfies readonly DocsPage[];

const DOCS_PAGE_BY_SLUG = new Map(DOCS_PAGES.map((page) => [page.slug, page]));

export function docsPageForSlug(slug: string): DocsPage | null {
  return DOCS_PAGE_BY_SLUG.get(slug) ?? null;
}

export function docsHtmlPath(page: DocsPage): string {
  return `/docs/${page.slug}`;
}

export function docsMarkdownPath(page: DocsPage): string {
  return `/docs/${page.slug}.md`;
}
