import { ARTIFACT_MODEL_DOC } from "./pages/artifact-model";
import { BILLING_DOC } from "./pages/billing";
import { CLI_DOC } from "./pages/cli";
import { DASHBOARD_DOC } from "./pages/dashboard";
import { EPHEMERAL_DOC } from "./pages/ephemeral";
import { GETTING_STARTED_DOC } from "./pages/getting-started";
import { LIMITS_DOC } from "./pages/limits";
import { MCP_DOC } from "./pages/mcp";
import { SAFETY_DOC } from "./pages/safety";
import { SHARING_DOC } from "./pages/sharing";
import type { DocsPage } from "./types";

export const DOCS_PAGES = [
  GETTING_STARTED_DOC,
  CLI_DOC,
  ARTIFACT_MODEL_DOC,
  SHARING_DOC,
  EPHEMERAL_DOC,
  DASHBOARD_DOC,
  BILLING_DOC,
  MCP_DOC,
  LIMITS_DOC,
  SAFETY_DOC,
] as const satisfies readonly DocsPage[];

export function docsPagesForBilling(billingEnabled: boolean): readonly DocsPage[] {
  return billingEnabled ? DOCS_PAGES : DOCS_PAGES.filter((page) => page.slug !== BILLING_DOC.slug);
}

export function docsHtmlPath(page: DocsPage): string {
  return `/docs/${page.slug}`;
}

export function docsMarkdownPath(page: DocsPage): string {
  return `/docs/${page.slug}.md`;
}
