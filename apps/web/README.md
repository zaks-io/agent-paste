# web

Typed Hono scaffold for the planned TanStack Start dashboard Worker.

Responsibilities:

- Auth0 login/logout/callback.
- Sealed web session cookie.
- Dashboard routes.
- Access Link viewer at `/al/{publicId}`.
- Operator UI.

Contracts: [`docs/specs/web.md`](../../docs/specs/web.md) and [`docs/specs/style-guide.md`](../../docs/specs/style-guide.md).

Current endpoints:

- `GET /healthz`
- `GET /openapi.json`
