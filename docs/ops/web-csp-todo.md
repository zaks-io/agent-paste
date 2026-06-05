# Web dashboard CSP — follow-ups

Source of truth for hardening the authenticated dashboard Content-Security-Policy after the enforcing baseline landed. Owner: Isaac. Snapshot date: 2026-06-05.

The dashboard now ships an **enforcing** CSP from `apps/web/src/security-headers.ts` (`dashboardCsp`, applied via `applyDashboardSecurityHeaders` in `apps/web/src/server.ts`). `script-src` is **nonce-based** (`'nonce-…' 'strict-dynamic'`, no `'unsafe-inline'`).

Nonce wiring (important — the obvious path does not work on this TanStack version): `server.ts` mints a per-request nonce (`generateCspNonce` from `@agent-paste/worker-runtime`) and runs the SSR render inside an `AsyncLocalStorage` scope (`apps/web/src/server/csp-nonce.ts`, kept out of the client bundle via `createIsomorphicFn`). `getRouter()` reads that scope and sets `router.options.ssr.nonce`, which is the **only** field TanStack reads to stamp `nonce='…'` onto injected scripts and emit `<meta property="csp-nonce">`. Passing the nonce via `handler.fetch(request, { context })` does **not** reach `ssr.nonce` and silently ships scriptless. The CF Analytics beacon is declared via `head().scripts` (`apps/web/src/lib/analytics-scripts.ts`), **not** as a JSX `<script>` — TanStack renders `head()` scripts through `<HeadContent>` and stamps the nonce on them, whereas an element-form `<script src>` is hoisted by React 19 and loses the nonce.

Access-link routes (`/al/*`, resolve/live proxies) keep their stricter CSP, layered on top afterward. The one item below tightens what remains.

## Open

- [ ] **Tighten `style-src` off `'unsafe-inline'`.** React/Tailwind v4 SSR + Turnstile inject inline styles, and there is no style-nonce path in TanStack Start today (the nonce stamping covers scripts, not `<style>`). Once a nonce/hash strategy exists for styles, drop `'unsafe-inline'` from `style-src`. This is a far smaller gap than inline script would be — inline `<style>` is not a script-execution XSS vector. (apex already nonces its single `<style>` block; the dashboard's many React-injected inline styles are the blocker here.)

## Done

- [x] **`connect-src` Sentry host confirmed against the real DSN region (2026-06-05).** Tightened to `https://*.ingest.us.sentry.io` (the DSN host pattern is `o<org>.ingest.us.sentry.io`; the old `*.ingest.sentry.io` wildcard could not match it — two labels before `.ingest`).
- [x] **Allowlist verified from real browser behavior on preview (2026-06-05).** Drove the authed dashboard, apex, and the Turnstile claim page in Chrome against `app.preview.agent-paste.sh`: zero CSP violations; the CF Analytics beacon (`beacon.min.js` + `rum` POST), Sentry SDK, and Turnstile all load and function. `'strict-dynamic'` loads the runtime-injected Turnstile loader — it carries the per-request nonce explicitly (read from `<meta property="csp-nonce">` via `apps/web/src/lib/csp-nonce-client.ts`, stamped in `apps/web/src/routes/_authed.claim.tsx`).

## Verification before closing the remaining item

- `apps/web/test/security-headers.test.ts` asserts the enforcing CSP shape; update it alongside any policy change.
- Manual browser pass: authed dashboard + the Turnstile claim page with zero CSP violations and working Turnstile / Sentry / CF Web Analytics.
