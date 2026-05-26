# OpenAPI Contract with Agent-Facing CLI

OpenAPI will be generated inline from REST route definitions in each HTTP app. The full-fidelity agent-facing surface is a hand-written CLI that wraps the REST contract; there is no separately published SDK in the MVP. Coding agents that need files, folders, binaries, or bundles invoke the CLI via `npx`, while integrations that cannot rely on `npx` talk to the documented REST API directly. [ADR 0061](./0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) adds an OAuth-only MCP surface for hosted agents, but MCP is intentionally text-only for publish/update operations and does not replace CLI/REST for binary or multi-file **Artifacts**.

## Consequences

- OpenAPI route metadata should live close to the Hono routes it documents rather than in a dedicated OpenAPI package.
- A shared contracts package can hold cross-app request, response, and domain types when they are genuinely shared.
- The CLI is the agent-first ergonomic layer and exposes **Publish** as its primary verb, hiding **Upload Session**, **Draft Revision**, idempotency, retries, and multipart details.
- The CLI talks to the public REST API directly. Its internal HTTP-client code is not exported as a library.
- The CLI is distributed as the `@zaks-io/agent-paste` npm package; the modal invocation is `npx @zaks-io/agent-paste publish <path>`, and the installed binary is `agent-paste`. A standalone binary is deferred until usage justifies a second build pipeline.
- Direct REST access is documented as an equal-standing public surface for integrations that cannot rely on `npx`: non-Node hosts, language ecosystems other than TypeScript, and server-to-server callers.
- Lower-level upload-session REST endpoints remain public and documented as advanced APIs; the CLI guides most users through `publish`.
- Superseded in part by [ADR 0037](./0037-internal-api-client-package-powers-cli.md): the initial `publish`-only CLI expands to management verbs (list, get, delete, access-link CRUD, lockdown, download, whoami). `publish` remains the primary verb.
- Superseded in part by [ADR 0060](./0060-cli-authentication-via-auth0-loopback.md): the primary interactive CLI auth path is `agent-paste login` via Auth0 loopback. `AGENT_PASTE_API_KEY` remains the CI/headless path, and the CLI still does not accept secrets as flags.
- A future TypeScript SDK is not precluded; it is deferred until a programmatic-embedding use case appears that the CLI cannot serve.
- Superseded in part by [ADR 0037](./0037-internal-api-client-package-powers-cli.md): the CLI's HTTP layer now lives in the workspace-only `packages/api-client/` package. The package remains unpublished, so the REST API stays the canonical public integration surface.
- The shared-contracts package gestured at above is realized by [ADR 0038](./0038-zod-schemas-as-source-of-truth-for-contracts.md) as `packages/contracts/`, with Zod schemas as the source of truth for both backend validation and SDK type inference.
