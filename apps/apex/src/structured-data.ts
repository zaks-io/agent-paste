import { META_DESCRIPTION } from "./copy";
import type { PageMeta } from "./meta";

// Schema.org JSON-LD for apex pages. This is invisible structured data that
// helps search engines understand the site as an entity (and renders rich
// results / breadcrumbs). It is NOT executable script: a
// <script type="application/ld+json"> block is a data block the browser never
// runs, so it is exempt from the CSP script-src directive and needs no hash or
// nonce (see Shell.tsx where it is emitted).
//
// House rules that apply here too: the product name is always the lowercase
// `agent-paste` (brand guide section 8), and the description reuses the single
// sanctioned apex meta description so the structured data can never drift from
// the <meta name="description"> copy.

// Canonical URLs are always production, matching the <link rel="canonical">
// tags, even on the preview deploy.
const SITE_URL = "https://agent-paste.sh";
const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

const ORGANIZATION = {
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: "agent-paste",
  url: SITE_URL,
  description: META_DESCRIPTION,
  logo: `${SITE_URL}/agent-paste-social.png`,
  sameAs: ["https://github.com/zaks-io/agent-paste"],
};

const WEBSITE = {
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  name: "agent-paste",
  url: SITE_URL,
  description: META_DESCRIPTION,
  publisher: { "@id": ORGANIZATION_ID },
};

// Home: identify the org and the site. Docs: a breadcrumb trail back to the
// docs index and home. Other pages get no JSON-LD (nothing to usefully assert
// beyond the page <meta>, and empty graphs are noise).
function breadcrumbList(meta: PageMeta): Record<string, unknown> | null {
  const path = meta.canonicalPath;
  if (path !== "/docs" && !path.startsWith("/docs/")) {
    return null;
  }
  const items = [
    { name: "Home", path: "/" },
    { name: "Docs", path: "/docs" },
  ];
  if (path !== "/docs") {
    // Strip the trailing "- agent-paste docs" suffix the routes append, so the
    // breadcrumb leaf reads as the bare page title.
    items.push({ name: meta.title.replace(/\s*-\s*agent-paste docs$/, ""), path });
  }
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}

/**
 * The JSON-LD `@graph` for a page, or null when the page asserts nothing beyond
 * its <meta>. Returns a ready-to-serialize object; Shell.tsx stringifies it into
 * the single <script type="application/ld+json"> block.
 */
export function structuredData(meta: PageMeta): Record<string, unknown> | null {
  const graph: Record<string, unknown>[] = [];
  if (meta.canonicalPath === "/") {
    graph.push(ORGANIZATION, WEBSITE);
  }
  const breadcrumbs = breadcrumbList(meta);
  if (breadcrumbs) {
    graph.push(breadcrumbs);
  }
  if (graph.length === 0) {
    return null;
  }
  return { "@context": "https://schema.org", "@graph": graph };
}
