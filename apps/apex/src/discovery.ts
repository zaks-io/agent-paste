import { API_BASE_URL, MCP_BASE_URL } from "./copy";

export const API_CATALOG_PATH = "/.well-known/api-catalog";

const LINKSET_MEDIA_TYPE = "application/linkset+json";

// RFC 9727 pins the catalog media type to Linkset (RFC 9264) and stamps the
// profile so a consumer knows it is reading an API catalog, not any linkset.
// The profile stays out of the Link header's `type` parameter: an RFC 8288
// quoted-string cannot carry the nested quotes the profile parameter needs.
export const API_CATALOG_CONTENT_TYPE = `${LINKSET_MEDIA_TYPE}; profile="https://www.rfc-editor.org/info/rfc9727"`;

type DiscoveryLink = { href: string; rel: string; type: string };

// The homepage's RFC 8288 Link header: the machine-readable entry points an
// agent can find without parsing marketing HTML. `api-catalog` (RFC 9727 §3) is
// the discovery root; the rest are IANA-registered relations pointing at the
// same resources the catalog expands on, so a client that only understands one
// of them still lands somewhere useful.
const HOMEPAGE_LINKS: readonly DiscoveryLink[] = [
  { href: API_CATALOG_PATH, rel: "api-catalog", type: LINKSET_MEDIA_TYPE },
  { href: `${API_BASE_URL}/openapi.json`, rel: "service-desc", type: "application/json" },
  { href: "/docs", rel: "service-doc", type: "text/html" },
  { href: "/agents.md", rel: "describedby", type: "text/markdown" },
  { href: "/llms.txt", rel: "describedby", type: "text/plain" },
];

export const DISCOVERY_LINK_HEADER = HOMEPAGE_LINKS.map(
  (link) => `<${link.href}>; rel="${link.rel}"; type="${link.type}"`,
).join(", ");

export function isHomepagePath(pathname: string): boolean {
  return pathname === "/" || pathname === "/index.html";
}

// The two APIs a client can integrate against directly. Both forms from RFC 9727
// Appendix A are present: the `item` bookmark list anchored at the catalog
// (A.2), so a consumer can enumerate the portfolio, and a per-API anchor
// carrying `service-desc`/`service-doc` (A.1), so it can go straight to the
// description without a second fetch.
export function apiCatalogDocument(origin: string): string {
  const document = {
    linkset: [
      {
        anchor: `${origin}${API_CATALOG_PATH}`,
        item: [{ href: API_BASE_URL }, { href: MCP_BASE_URL }],
      },
      {
        anchor: API_BASE_URL,
        "service-desc": [
          {
            href: `${API_BASE_URL}/openapi.json`,
            type: "application/json",
            title: "agent-paste HTTP API (OpenAPI)",
          },
        ],
        "service-doc": [
          { href: `${origin}/docs/cli`, type: "text/html", title: "CLI reference" },
          { href: `${API_BASE_URL}/auth.md`, type: "text/markdown", title: "Agent auth metadata" },
        ],
      },
      {
        anchor: MCP_BASE_URL,
        "service-desc": [
          {
            href: `${MCP_BASE_URL}/.well-known/oauth-protected-resource`,
            type: "application/json",
            title: "MCP protected resource metadata",
          },
        ],
        "service-doc": [{ href: `${origin}/docs/mcp`, type: "text/html", title: "MCP server docs" }],
      },
    ],
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}
