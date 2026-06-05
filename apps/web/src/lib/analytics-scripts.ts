// Cloudflare Web Analytics beacon, expressed as a head() scripts entry rather
// than a JSX <script>. TanStack renders head() scripts through <HeadContent> and
// stamps the per-request CSP nonce on them; an element-form <script src> is
// hoisted by React 19 and loses the nonce, which the dashboard's
// script-src 'strict-dynamic' then blocks. Returns [] when no token is set
// (dev/preview without a token), so nothing renders.
export function analyticsScripts(token?: string): Array<Record<string, string | boolean>> {
  const trimmed = token?.trim();
  if (!trimmed) {
    return [];
  }
  return [
    {
      src: "https://static.cloudflareinsights.com/beacon.min.js",
      defer: true,
      "data-cf-beacon": JSON.stringify({ token: trimmed }),
    },
  ];
}
