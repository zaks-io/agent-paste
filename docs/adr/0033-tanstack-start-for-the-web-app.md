# TanStack Start on Cloudflare Workers for the Web App

The `web` Worker will use TanStack Start (React) deployed to Cloudflare Workers via the official `@cloudflare/vite-plugin`. TanStack Start provides server-side rendering, streaming, server functions, and TanStack Router's type-safe file-based routing in a single framework, with Cloudflare Workers as an official deployment partner. The dashboard's authenticated forms, inline edits, and confirmation modals compose cleanly with server functions and TanStack Query where client-side caching is needed.

## Considered Options

- **React Router 7 framework mode.** Strong alternative with progressive-enhancement `<Form>` semantics and a mature Cloudflare adapter. TanStack Start chosen for tighter first-party Cloudflare partnership, built-in type-safe routing, and direct composition with TanStack Query inside the dashboard.
- **OpenNext (Next.js on Cloudflare).** Largest ecosystem, but a two-layer adapter chain (Next runtime → `opennextjs-cloudflare` → Workers) and App Router and RSC overhead is too heavy for this surface size.
- **Astro on Cloudflare.** Strong for content-first sites with island sprinkles; weaker for a form-heavy dashboard once interactive surfaces end up using React inside islands anyway.
- **Hono + JSX with no client hydration.** Smallest deviation from ADR 0016, but pure SSR makes inline editing and modal flows clunky enough that the JavaScript savings do not pay back.

## Consequences

- The `web` Worker is the only app that diverges from the Hono-first HTTP routing established by ADR 0016. The `api`, `upload`, `content`, and `jobs` Workers stay on Hono.
- Build tooling is Vite with `@tanstack/react-start/plugin/vite` and `@cloudflare/vite-plugin`; production deploys via `wrangler deploy`, aligning with ADR 0013's wrangler-first stance.
- Routes are file-based under TanStack Router conventions; route loaders handle initial server-side data, and server functions handle mutations.
- Loader-level session checks integrate with Auth0 (ADR 0002) to gate authenticated routes under `/app/*`.
- The `web` Worker serves `app.agent-paste.sh` only, per [ADR 0014](./0014-single-domain-with-hardened-content-subdomain.md). Its `/` route redirects by Auth0 session presence (`/dashboard` if signed in, `/login` if not); there is no public landing page on `app.`. Agent-discoverable files `/llms.txt` and `/agents.md` live on the marketing apex `agent-paste.sh`, not on the `web` Worker, because they describe the platform and agents look for them at the canonical domain root.
- The web app has three route groups: an unauthenticated shell (`/`, `/login`, `/logout`, `/auth/callback`), an Access Link viewer group (`/al/*`) that renders without the Auth0 SDK on the client, an authenticated dashboard group (`/_authed/*`), and an operator group (`/admin/*`) gated to the `OPERATOR_EMAILS` allowlist from [ADR 0046](./0046-operator-identity-and-web-admin-surface.md). A lint rule forbids imports from auth modules inside `/al/*` so the unauthenticated bundle does not regress.
- The `web` Worker has no Hyperdrive, R2, or KV bindings. Every server function and route loader fetches from the `api` Worker over HTTPS so that mutation rules (`runCommand`, idempotency, scope checks, RLS context, audit events, rate limits, Usage Policy) live in exactly one place.
- TanStack Query is available for client-side caching when state needs to outlive a navigation or refetch in the background; route loaders cover initial data.
- shadcn/ui can be adopted for dashboard components without introducing a separate UI framework.
