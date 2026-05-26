# Local Harness

This folder is the default fixture for `pnpm smoke:local`.

## Quick path

1. Start the harness: `pnpm dev:all`
2. Sign in: `pnpm cli:dev login` (mock WorkOS in local smoke) or set `AGENT_PASTE_API_KEY` from the dashboard
3. Publish: `pnpm cli:dev publish /absolute/path/to/examples/local-harness/site`

For scripted smokes, the harness exposes `SMOKE_HARNESS_SECRET` (see `.env.example`) on non-production `__test__/*` routes.
