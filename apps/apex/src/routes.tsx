import type { ReactNode } from "react";
import { DOCS_PAGES, docsHtmlPath } from "./docs/registry";
import { PRIVACY } from "./legal-privacy";
import { TERMS } from "./legal-terms";
import type { LegalDocument } from "./legal-types";
import { ABOUT_META, HOME_META, HOW_IT_WORKS_META, type PageMeta } from "./meta";
import { AboutPage } from "./pages/AboutPage";
import { DocsIndexPage } from "./pages/DocsIndexPage";
import { DocsPageView } from "./pages/DocsPageView";
import { HomePage } from "./pages/HomePage";
import { HowItWorksPage } from "./pages/HowItWorksPage";
import { LegalPage } from "./pages/LegalPage";
import { PricingPage } from "./pages/PricingPage";
import { PRICING_META } from "./pricing";

export type ApexRoute = {
  path: string;
  meta: PageMeta;
  // The home page sets its own section widths (full bleed); every other page is
  // wrapped in the constrained `.page-body` reading column by the Shell.
  bleed?: boolean;
  element: ReactNode;
};

const DOCS_DESCRIPTION =
  "Official agent-paste usage docs covering install, auth, publish, Artifacts, Access Links, billing, MCP, limits, and safety.";

const DOCS_INDEX_META: PageMeta = {
  title: "agent-paste docs",
  description: DOCS_DESCRIPTION,
  canonicalPath: "/docs",
};

function legalMeta(document: LegalDocument): PageMeta {
  return {
    title: `${document.title} | agent-paste.sh`,
    description: document.description,
    canonicalPath: document.path,
  };
}

// The full apex route table. `/pricing` only exists when billing is enabled, so
// the production build (BILLING_ENABLED=false) literally never prerenders it and
// the worker shim 404s the path.
export function getRoutes(billingEnabled: boolean): ApexRoute[] {
  return [
    { path: "/", meta: HOME_META, bleed: true, element: <HomePage /> },
    { path: "/about", meta: ABOUT_META, element: <AboutPage /> },
    { path: "/how-it-works", meta: HOW_IT_WORKS_META, element: <HowItWorksPage /> },
    ...(billingEnabled ? [{ path: "/pricing", meta: PRICING_META, element: <PricingPage /> }] : []),
    { path: "/docs", meta: DOCS_INDEX_META, element: <DocsIndexPage /> },
    ...DOCS_PAGES.map((page) => ({
      path: docsHtmlPath(page),
      meta: {
        title: `${page.title} - agent-paste docs`,
        description: page.summary,
        canonicalPath: docsHtmlPath(page),
      },
      element: <DocsPageView page={page} />,
    })),
    { path: "/terms", meta: legalMeta(TERMS), element: <LegalPage document={TERMS} /> },
    { path: "/privacy", meta: legalMeta(PRIVACY), element: <LegalPage document={PRIVACY} /> },
  ];
}
