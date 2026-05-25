# auth

Shared request, admin-token, and cached-lookup primitives.

Responsibilities:

- Request ID propagation and public error body helpers.
- Admin bearer token HMAC hashing and constant-time verification.
- Secret cache key derivation.
- Two-layer cached lookups using isolate memory plus `caches.default`.

This package must not make authentication ambient. Each app explicitly wires only the auth modes it accepts.
