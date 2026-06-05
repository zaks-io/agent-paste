# web

TanStack Start dashboard Worker for `app.agent-paste.sh`.

Contracts: [`docs/specs/web.md`](../../docs/specs/web.md) and [`docs/specs/style-guide.md`](../../docs/specs/style-guide.md). Architecture: [ADR 0033](../../docs/adr/0033-tanstack-start-for-the-web-app.md), [ADR 0068](../../docs/adr/0068-workos-authkit-for-web-app-auth.md), [ADR 0059](../../docs/adr/0059-web-app-session-and-auth-forwarding-to-api.md), [ADR 0047](../../docs/adr/0047-access-link-signed-url-with-fragment-encoded-payload.md).

## Stack

- TanStack Start (file-based routes, server functions, SSR) on Cloudflare Workers via `@cloudflare/vite-plugin` (`viteEnvironment: { name: "ssr" }`).
- WorkOS AuthKit via [`@workos/authkit-tanstack-react-start`](https://github.com/workos/authkit-tanstack-start). Middleware in `src/start.ts` validates and refreshes sessions on every request; route loaders call `getAuth()` directly to read the authenticated user.
- Sealed `__agp_session` cookie owned by AuthKit (iron-session blob, HttpOnly, Secure, SameSite=Lax, no `Domain`). Cookie name is set via `WORKOS_COOKIE_NAME`. PKCE state lives in short-lived AuthKit-owned cookies cleared on callback.
- Service binding `API` to `agent-paste-api-{preview,production}`; the WorkOS access token is forwarded as `Authorization: Bearer`.
- Tailwind v4 with style-guide `@theme` tokens. Hand-rolled component primitives (no shadcn dependency at runtime - only the pattern).
- Self-hosted Bricolage Grotesque + IBM Plex Mono via `@fontsource*`.

## Routes

Every spec route from `docs/specs/web.md` resolves. Dashboard loaders and mutations are wired to the live `/v1/web/*` API routes for workspace, artifact, key, Access Link, audit, settings, claim, and billing flows.

```
/                          → redirect by session
/api/auth/sign-in          307 → WorkOS hosted flow
/api/auth/sign-out         POST → signOut()
/api/auth/callback         AuthKit handleCallbackRoute()
/al/:publicId              Access Link viewer (no session imports, lint-enforced)
/healthz                   JSON health
/dashboard                 _authed
/artifacts                 _authed
/artifacts/:artifactId     _authed
/access-links              _authed
/keys                      _authed
/audit                     _authed
/settings                  _authed
/billing                   _authed
/claim                     _authed/guest handoff
/admin                     _authed + is_operator guard
```

## Local dev

```bash
pnpm install
pnpm dev:web   # http://localhost:5173, with the local API harness on 8787
```

`.dev.vars` (gitignored) needs:

```
WORKOS_CLIENT_ID=client_...
WORKOS_API_KEY=sk_...
WORKOS_REDIRECT_URI=http://localhost:5173/api/auth/callback
WORKOS_COOKIE_PASSWORD=...        # at least 32 chars
WORKOS_COOKIE_NAME=__agp_session
WEB_BASE_URL=http://localhost:5173
CONTENT_BASE_URL=http://127.0.0.1:8789
```

Without a WorkOS project provisioned, `/api/auth/sign-in` still redirects to the AuthKit hosted flow; the callback fails. Dashboard chrome and `EmptyState` rendering work without secrets.
Admin routes require the signed-in WorkOS session to carry the `admin` role slug.

## Scripts

- `pnpm --filter @agent-paste/web dev` - Vite dev server with HMR.
- `pnpm --filter @agent-paste/web build` - produces `dist/client` + worker entry.
- `pnpm --filter @agent-paste/web typecheck` - `tsc --noEmit`.
- `pnpm --filter @agent-paste/web lint` - Biome lint (includes the Access Link import guard).
- `pnpm --filter @agent-paste/web test` - Vitest component, loader, formatting, and mutation tests.
- `pnpm --filter @agent-paste/web typegen` - regenerate Cloudflare binding types.
- `pnpm --filter @agent-paste/web deploy:preview` / `deploy:production` - `wrangler deploy --env ...`.

## Lint rules

`biome.json` adds a `noRestrictedImports` override for `apps/web/src/routes/al.*` that blocks imports from `../server/auth`, `../server/auth-fns`, `@workos/authkit-tanstack-react-start`, `@workos/authkit-session`, and `@tanstack/react-start/server`. Adding any of those imports to an Access Link route fails `pnpm lint`. This is the runtime guarantee behind ADR 0033's "Access Link viewer must not touch session modules" requirement.

## Deploy

Per `wrangler.jsonc`:

- `preview` env: route `app.preview.agent-paste.sh`, service binding to `agent-paste-api-preview`.
- `production` env: route `app.agent-paste.sh`, service binding to `agent-paste-api-production`.

Preview and production deploys run with `CLOUDFLARE_ENV=<target>` so the Cloudflare/Vite plugin emits the target-specific worker config.

Production is never deployed without explicit operator approval (ADR 0067, project-level convention).
