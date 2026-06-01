# auth

Shared request, cached-lookup, WorkOS, and MCP bearer primitives.

Responsibilities:

- Request ID propagation and public error body helpers.
- Secret cache key derivation.
- Two-layer cached lookups using isolate memory plus `caches.default`.
- WorkOS JWT/JWKS verification, user fetch, and identity resolution.
- MCP OAuth bearer verification and member actor resolution helpers.

This package must not make authentication ambient. Each app explicitly wires only the auth modes it accepts.
