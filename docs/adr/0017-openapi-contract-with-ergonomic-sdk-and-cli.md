# OpenAPI Contract with Agent-Facing CLI

OpenAPI will be generated inline from REST route definitions in each HTTP app. The public agent-facing surface is a hand-written CLI that wraps the REST contract; there is no separately published SDK in the MVP. Coding agents are the canonical agent shape in the MVP and invoke the CLI via `npx`, while integrations that cannot rely on `npx` talk to the documented REST API directly. This keeps agent ergonomics in one place without forcing the platform to ship and maintain a library alongside the CLI.

## Consequences

- OpenAPI route metadata should live close to the Hono routes it documents rather than in a dedicated OpenAPI package.
- A shared contracts package can hold cross-app request, response, and domain types when they are genuinely shared.
- The CLI is the agent-first ergonomic layer and exposes **Publish** as its primary verb, hiding **Upload Session**, **Draft Revision**, idempotency, retries, and multipart details.
- The CLI talks to the public REST API directly. Its internal HTTP-client code is not exported as a library.
- The CLI is distributed as an npm package; the modal invocation is `npx agent-paste publish <path>`. A standalone binary is deferred until usage justifies a second build pipeline.
- Direct REST access is documented as an equal-standing public surface for integrations that cannot rely on `npx`: non-Node hosts, language ecosystems other than TypeScript, and server-to-server callers.
- Lower-level upload-session REST endpoints remain public and documented as advanced APIs; the CLI guides most users through `publish`.
- The CLI surface stays minimal in v1: `publish` only. Management actions (revoke, lockdown, deletion, display-metadata updates, listing, post-publish Share Link creation) live on the dashboard and REST until a real user need justifies adding them.
- Authentication uses the `AGENT_PASTE_API_KEY` environment variable; no flag and no on-disk config in v1.
- A future TypeScript SDK is not precluded; it is deferred until a programmatic-embedding use case appears that the CLI cannot serve.
