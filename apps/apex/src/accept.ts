// Accept-header content negotiation for the Markdown twins of the HTML pages.
//
// Markdown is served only when the client names `text/markdown` explicitly and
// ranks it at least as high as HTML. A browser's `*/*;q=0.8` tail therefore
// never wins: wildcards are read as the HTML preference, not as a markdown
// request. That keeps HTML the default for humans while an agent sending
// `Accept: text/markdown` gets the clean text.
// <https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/>

const MARKDOWN_TYPES = new Set(["text/markdown", "text/x-markdown"]);
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml", "text/*", "*/*"]);

type MediaRange = { type: string; quality: number };

export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) {
    return false;
  }
  const ranges = parseAccept(accept);
  const markdown = bestQuality(ranges, MARKDOWN_TYPES);
  return markdown > 0 && markdown >= bestQuality(ranges, HTML_TYPES);
}

function parseAccept(header: string): MediaRange[] {
  return header.split(",").flatMap((entry) => {
    const [rawType, ...params] = entry.split(";");
    const type = (rawType ?? "").trim().toLowerCase();
    return type ? [{ type, quality: parseQuality(params) }] : [];
  });
}

// RFC 9110 weights: at most three decimal places in [0, 1]. The whole token has
// to match, because `parseFloat` would read `0.9junk` as `0.9` and let a typo
// quietly reorder the client's preferences.
//
// A malformed or out-of-range `q` is ignored rather than treated as a rejection,
// so a broken parameter can never silently downgrade a type to zero.
const QUALITY_PATTERN = /^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/;

function parseQuality(params: string[]): number {
  for (const param of params) {
    const [name, value] = param.split("=");
    if (name?.trim().toLowerCase() !== "q") {
      continue;
    }
    const weight = (value ?? "").trim();
    return QUALITY_PATTERN.test(weight) ? Number.parseFloat(weight) : 1;
  }
  return 1;
}

function bestQuality(ranges: MediaRange[], types: ReadonlySet<string>): number {
  return ranges.reduce((best, range) => (types.has(range.type) ? Math.max(best, range.quality) : best), 0);
}
