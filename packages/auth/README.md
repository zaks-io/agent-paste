# auth

Planned shared authentication and authorization primitives.

Responsibilities:

- Auth0 JWT verification helpers.
- API Key parser and verifier.
- Scope registry and `requireScopes` logic.
- Actor context shape.

This package must not make authentication ambient. Each app explicitly wires only the auth modes it accepts.
