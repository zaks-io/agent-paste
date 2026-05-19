# Hono and OpenAPI for Worker HTTP APIs

Worker HTTP apps will use Hono for routing and middleware, with OpenAPI documentation generated for REST endpoints. This keeps the API lightweight and Cloudflare-friendly while making the agent-facing integration contract discoverable and testable.

## Consequences

- `api`, `upload`, and `content` can share Hono middleware patterns for request IDs, errors, logging, auth, and response shaping.
- REST endpoints should be documented through an OpenAPI plugin close to the route definitions.
- The OpenAPI output should be published for humans and usable by agents or client-generation tooling.
- The platform should avoid hiding the public integration surface behind an undocumented internal RPC protocol.
