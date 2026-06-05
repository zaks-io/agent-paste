// Read the per-request CSP nonce on the client. TanStack Start emits it as
// <meta property="csp-nonce" content="…"> during SSR (and reads it back the same
// way to hydrate router.options.ssr.nonce). Scripts we inject at runtime under
// script-src 'strict-dynamic' must carry this nonce to be trusted directly,
// rather than relying on transitive trust from the injecting script.
export function readCspNonce(): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]');
  return meta?.content || undefined;
}
