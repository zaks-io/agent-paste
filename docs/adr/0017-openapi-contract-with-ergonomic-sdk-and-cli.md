# OpenAPI Contract with Ergonomic SDK and CLI

OpenAPI will be generated inline from REST route definitions in each HTTP app, while the public SDK and CLI will be hand-written ergonomic layers around those contracts. This keeps the API documented and testable without forcing agents or humans to work directly with low-level upload-session and multipart details.

## Consequences

- OpenAPI route metadata should live close to the Hono routes it documents rather than in a dedicated OpenAPI package.
- A shared contracts package can hold cross-app request, response, and domain types when they are genuinely shared.
- The SDK should expose agent-first operations such as `publish` and `update`.
- The CLI should use the SDK rather than duplicating raw HTTP behavior.
- Direct REST access remains documented for agents and integrations that prefer plain HTTP.
