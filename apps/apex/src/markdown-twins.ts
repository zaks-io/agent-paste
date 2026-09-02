// Every HTML page on the apex has a Markdown twin at a stable `.md` path. The
// twin is what `Accept: text/markdown` on the HTML path returns, so the two
// surfaces can never drift: one body, two addresses.

// Non-docs pages. Docs pages already own the `/docs/{slug}.md` convention and
// are mapped by pattern below.
const PAGE_TWINS: Record<string, string> = {
  "/": "/index.md",
  "/about": "/about.md",
  "/how-it-works": "/how-it-works.md",
  "/pricing": "/pricing.md",
  "/docs": "/docs.md",
  "/terms": "/terms.md",
  "/privacy": "/privacy.md",
};

const DOCS_PAGE_PATTERN = /^\/docs\/([a-z0-9-]+)$/;

/** Every fixed Markdown twin path, for the worker's text-asset membership check. */
export const PAGE_TWIN_PATHS: readonly string[] = Object.values(PAGE_TWINS);

/** The `.md` path serving `pathname`'s content, or undefined if it has no twin. */
export function markdownTwinPath(pathname: string): string | undefined {
  const normalized = pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const twin = PAGE_TWINS[normalized];
  if (twin) {
    return twin;
  }
  return DOCS_PAGE_PATTERN.test(normalized) ? `${normalized}.md` : undefined;
}

/** The twin path for a page that must have one. Throws rather than guessing. */
export function requireMarkdownTwin(htmlPath: string): string {
  const twin = markdownTwinPath(htmlPath);
  if (!twin) {
    throw new Error(`No Markdown twin registered for ${htmlPath}`);
  }
  return twin;
}

/** Rewrites an on-site HTML link to its Markdown twin; other links pass through. */
export function markdownLink(href: string): string {
  const suffixIndex = href.search(/[?#]/);
  const path = suffixIndex === -1 ? href : href.slice(0, suffixIndex);
  const twin = markdownTwinPath(path);
  return twin ? `${twin}${href.slice(path.length)}` : href;
}
