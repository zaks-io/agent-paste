# apex

The marketing surface for `agent-paste.sh` and the home of agent-discoverable files (`/llms.txt`, `/agents.md`).

The apex never hosts authenticated state, never receives WorkOS callbacks, and never sets cookies. Any request that resolves to a product surface (`/dashboard`, `/artifacts/*`, `/keys`, `/audit`, `/settings`, `/admin/*`, `/al/*`, `/r/*`, `/login`, `/logout`, `/auth/*`) returns a 308 redirect to the equivalent path on `app.agent-paste.sh`.

Authoritative references:

- [ADR 0014](../../docs/adr/0014-single-domain-with-hardened-content-subdomain.md) — apex behavior and cookie boundary.
- [ADR 0033](../../docs/adr/0033-tanstack-start-for-the-web-app.md) — why `/llms.txt` and `/agents.md` live here and not on `app`.
- [Style Guide §8.1](../../docs/specs/style-guide.md) — marketing surface composition.
