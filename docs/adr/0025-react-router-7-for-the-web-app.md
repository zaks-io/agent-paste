# React Router 7 on Cloudflare Workers for the Web App

The `web` Worker will use React Router 7 framework mode (the evolution of Remix) on the Cloudflare Workers adapter. The dashboard's interaction model — authenticated forms, inline edits, copy-to-clipboard affordances, and confirmation modals — fits React Router 7's progressive-enhancement grain better than Next.js (via OpenNext) or Astro at this surface size, and `<Form>` + action keeps mutations working without JavaScript.

## Considered Options

- **OpenNext (Next.js on Cloudflare).** Largest ecosystem and most familiar DX, but introduces a two-layer adapter chain (Next runtime → `opennextjs-cloudflare` → Workers) and brings App Router and RSC overhead that this surface does not need.
- **Astro on Cloudflare.** Strongest for content-first sites with island sprinkles; weaker for a form-heavy dashboard where most interactive components end up using React inside islands anyway.
- **Hono + JSX with no client hydration.** Smallest deviation from ADR 0016, but pure SSR makes inline editing and modal flows clunky enough that the cost outweighs the JavaScript savings.

## Consequences

- The `web` Worker is the only app that diverges from the Hono-first HTTP routing established by ADR 0016. The `api`, `upload`, `content`, and `jobs` Workers stay on Hono.
- `<Form>` + action is the canonical mutation pattern; mutations should work without JavaScript and progressively enhance when hydration is available.
- Loader-level session checks integrate with Auth0 (ADR 0002) to gate authenticated routes under `/app/*`.
- Public routes (`/`, `/llms.txt`, `/agents.md`) are server-rendered without per-request authentication and may emit non-HTML content types as needed.
- Local development aligns with ADR 0013's wrangler-first stance using React Router 7's Cloudflare adapter.
- shadcn/ui can be adopted for dashboard components without introducing a separate UI framework.
