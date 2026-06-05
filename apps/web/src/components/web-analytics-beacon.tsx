// Cloudflare Web Analytics. Renders the official beacon only when a token is
// configured (production), so dev/preview stay beacon-free. The token is public
// by design, so server-rendering it into the document is fine.
export function WebAnalyticsBeacon({ token }: { token?: string | undefined }) {
  const trimmed = token?.trim();
  if (!trimmed) {
    return null;
  }
  return (
    <script
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token: trimmed })}
    />
  );
}
