# Architecture

## Runtime boundaries

| Runtime   | Owns                                                                                   | Does not own                                   |
| --------- | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `apex`    | Public site and documentation.                                                         | Artifact bytes or account state.               |
| `web`     | Authenticated management console and session handling.                                 | Recipient rendering or durable product writes. |
| `api`     | Publish orchestration, metadata, authorization, capability manifests, management APIs. | Serving Artifact bytes.                        |
| `upload`  | Resumable upload ingress into private R2.                                              | Public Artifact URLs.                          |
| `content` | Capability-host resolution, token verification, byte decryption, content headers.      | User sessions or metadata mutation.            |
| `jobs`    | Asynchronous lifecycle and cleanup work.                                               | Interactive request handling.                  |
| `mcp`     | OAuth verification, MCP transport validation, tool dispatch, and private RPC calls.    | Public API bearer delegation or durable state. |

`stream` remains deployable only for migration history. No shipped route or
publish flow calls it. Preview and production expose its health check only;
historical Live Updates routes are enabled solely by the local migration harness.

The `mcp` Worker is the only runtime that accepts an MCP OAuth bearer. It validates
the token and passes only the verified WorkOS subject plus an allowlisted Route ID
to named `McpApiEntrypoint` or `McpUploadEntrypoint` RPC methods. The downstream
Workers reject MCP bearers on their public HTTP routes, validate that the method
and path match the Route Contract, resolve the subject to a Workspace Member, and
apply the normal scope and rate-limit guards. `Authorization` never crosses the
service binding.

## Publish flow

1. A client uploads files and finalizes a Revision through `api` and `upload`.
2. `api` commits the Revision and writes the latest capability manifest to R2.
3. The manifest binds a random 95-bit capability ID to a signed exact-Revision
   content token and entrypoint.
4. `api` returns the capability origin as `url`.
5. The browser opens that origin directly. `content` resolves the hostname,
   loads the manifest, verifies the signed token, and serves decrypted bytes.

Production hosts are `{capabilityId}.agent-paste.link`. Preview hosts are
`{capabilityId}-preview.agent-paste.link`. New capability IDs are 23-character
grouped base32 strings with a check symbol. Legacy 32-character lowercase
hexadecimal IDs remain valid. The ID is the bearer secret, so logs retain only
redacted host metadata.

## Routing

The content Worker owns wildcard routes `*.agent-paste.link/*` in production and
`*-preview.agent-paste.link/*` in preview. Temporary legacy routes on
`agent-paste.sh` redirect old capability hosts to `.link` and preserve the
explicit product-host forwarding required while that wildcard remains. Unknown
wildcard hosts fail closed. Capability-manifest lookups have a separate per-IP
3,000-request-per-minute rate limit before the first R2 read, so generated
valid-form hostnames cannot bypass the 600-request-per-minute Artifact-and-IP
limiter. See [read rate limits](./content-rendering.md#read-rate-limits) for
request counting and environment scope.

## Rendering and CSP

Artifacts are websites, not documents embedded by the management app. The
capability response uses the tier-selected policies in
[`content-rendering.md`](./content-rendering.md), always denies framing, blocks
service workers, and does not inject viewer scripts or wrappers.

Previously issued signed content URLs remain an expiration-only compatibility
path. New publishes cannot fall back to that path in preview or production.

## Storage and authority

Postgres owns Workspace, Artifact, Revision, credential, billing, audit, and
lifecycle metadata. R2 owns encrypted Artifact bytes and capability manifests.
KV and Durable Objects are not authority for which Revision a capability host
serves. A publish is successful only after its durable metadata and manifest
write succeed.

The interactive `api` and `upload` Workers use targeted placement in
`aws:us-east-1`, matching their Neon databases. Checked-in preview and
production environments and generated per-PR previews preserve that placement
so the publish path does not pay cross-region latency for each database query.

See [ADR 0094](../adr/0094-capability-url-is-the-artifact-link.md) and
[ADR 0095](../adr/0095-isolate-active-content-and-restore-ephemeral-execution-policy.md)
for the direct-origin and isolation decisions.

## Observability

All eight deployable Workers export structured console logs through the
Cloudflare destination `axiom-logs`. Workers with native tracing enabled
(`api`, `jobs`, `mcp`, `apex`, `web`, and the dormant `stream`) export traces to
both `axiom-traces` and `sentry-agent-paste-traces`. Standing preview and
production inherit these destinations from the root Wrangler config. Generated
PR previews preserve each Worker's observability settings.

`content` and `upload` disable native traces and invocation logs because their
request hosts or paths contain bearer credentials. Their application console
logs remain enabled and sanitized. Their Sentry SDK traces and errors pass
through the shared `worker-runtime` sanitizers before export. Native Cloudflare
exports do not pass through these SDK hooks. There is currently no sanitized
trace exporter to Axiom for these two Workers; enabling native tracing would
expose capability IDs or signed upload/content tokens.

Every Worker uses the Sentry SDK, enabled only when a non-empty `SENTRY_DSN` is
bound. Deploy workflows pass this optional provider configuration to the secret
planner; Web uses the same DSN for its browser SDK. SDK trace sampling defaults
to `1`. Workers reject invalid non-empty `SENTRY_TRACES_SAMPLE_RATE` values;
Web and Apex receive the same configured rate. Downstream SDK spans inherit
the originating sampling decision when trace context is present.

SDK HTTP body capture is explicitly disabled in the HttpServer integration.
Both error events and transactions use the shared request sanitizer to remove
bodies, cookies, query strings, and sensitive headers before export.

SDK application traces propagate `sentry-trace`, W3C `traceparent`, and Sentry
`baggage` to trusted first-party control-plane HTTP destinations. Service-binding
requests carry the active client span's context explicitly. Named MCP RPC
receivers use the SDK request wrapper because the pinned SDK does not instrument
custom Worker entrypoint methods. External providers and uploaded Artifact
origins do not receive automatic tracing headers.

Queue producers attach optional, bounded `trace_context` metadata after parsing
the business payload. Jobs restore each message's producing context in its own
scope, including retries and the bundle DLQ, rather than inheriting the batch
trace. Legacy messages and malformed optional telemetry start independent
traces. Only supported Sentry sampling/release baggage is retained; arbitrary
baggage and transaction names are excluded. Ack/retry behavior is unchanged.

Sanitized SDK spans and warning/error logs identify their Worker with a stable
`service.name` such as `agent-paste-api`. Browser spans use
`agent-paste-web-browser` or `agent-paste-apex-browser`. Normal production,
standing preview, and PR deploys pass the same `SENTRY_RELEASE` to every Worker
and browser configuration, defaulting to the exact checked-out commit. Web's
source-map build uses that release too. Trace-linked logs retain their active
span association after sanitization.

Native Cloudflare exports and SDK application traces are separate tracing
contexts. Exporting both to Sentry does not join them: Cloudflare currently does
not propagate native context to external services or expose native trace/span
IDs through its custom-span API. Native exports remain platform diagnostics;
the SDK owns supported application trace continuity.

See the [observability runbook](../ops/runbook-observability.md) for destination
setup, deployed-state verification, and the dated audit of remaining live gaps.
