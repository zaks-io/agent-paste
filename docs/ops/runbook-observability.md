# Worker observability

The [architecture spec](../specs/architecture.md#observability) owns the telemetry
contract. This runbook describes setup and verification. Destination names are
Cloudflare account-level slugs, not Axiom dataset names.

| Signal                | Cloudflare destination       | Receiver                                   |
| --------------------- | ---------------------------- | ------------------------------------------ |
| Logs                  | `axiom-logs`                 | Axiom `/v1/logs`, dataset `cloudflare`     |
| Native traces         | `axiom-traces`               | Axiom `/v1/traces`, dataset `cloudflare`   |
| Native traces         | `sentry-agent-paste-traces`  | Sentry project `agent-paste` OTLP endpoint |
| SDK traces and errors | Not a Cloudflare destination | Sentry project selected by `SENTRY_DSN`    |

## Setup

Configure and enable the three account-level destinations with the provider's
ingest headers. Keep ingest tokens out of Wrangler configs and repository files.
Each native trace config selects both trace destinations; its logs select only
`axiom-logs`. Content and Upload must keep native traces and invocation logs
disabled because their URLs contain credentials. Their SDK export is sanitized.

Set `SENTRY_DSN` in the GitHub `Preview` and `Production` environments, using the
DSN for the `agent-paste` Sentry project. `SENTRY_AUTH_TOKEN` only uploads source
maps; it does not enable runtime telemetry. The normal deploy planner routes a
provided DSN to all eight Workers and leaves existing bindings alone when it is
unset. PR previews provision the optional DSN through their secrets files,
including Apex and Web. No DSN is generated from random bytes.

SDK sampling defaults to `1`. Keep any `SENTRY_TRACES_SAMPLE_RATE` override
consistent across the fleet; Web and Apex receive their Worker's rate. Invalid
non-empty values fail configuration validation. Downstream SDK spans inherit
the originating sampling decision. Cloudflare native sampling is a separate
setting and does not inherit the SDK rate.

Normal deployment scripts resolve one `SENTRY_RELEASE` from the exact checkout
commit, or preserve an explicit override. Wrangler receives it as a runtime
binding, and Web's source-map build receives the same release through Turbo's
strict environment configuration. Do not configure a separate release per
Worker for these deploys.

Production deployments and credential changes require explicit approval under
[`AGENTS.md`](../../AGENTS.md#project-stage). Use the normal deployment workflows
after configuring the DSN; do not manually patch production Worker settings.

## Verify delivery

Read each deployed Worker's settings and inspect only observability settings,
the presence of the `SENTRY_DSN` binding, and the sampling rate. Never print
binding values. Confirm the six native-tracing Workers select both trace
destinations, all eight select `axiom-logs`, and Content/Upload retain their
disabled native settings. Verify standing preview as well as production.

Inspect destination status for a recent successful export and no current error.
An enabled destination without a successful export is configuration evidence,
not proof of delivery. Search Sentry project `agent-paste` for recent production
spans and SDK errors; native spans do not establish that SDK error capture works.

Use an aggregate-only Axiom query scoped to this project's Worker names:

```apl
['cloudflare']
| where ['resource.cloudflare.script_name'] startswith 'agent-paste-'
| summarize events=count() by ['resource.cloudflare.script_name']
```

Logs can also contain trace/span IDs, so their presence alone does not prove
trace ingestion. Check the trace destination's export status separately. A quiet
Worker may have no recent application logs; do not enable credential-bearing
invocation logs just to produce a log row. Exercise a safe preview request when
needed and verify its telemetry without publishing production artifacts.

## Verify application trace continuity

Use Sentry SDK application spans for this check. Native export delivery proves
only that platform telemetry arrived; it does not prove SDK propagation.

1. Deploy the branch through the normal preview workflow. Confirm the changed
   Workers and browser configuration report the same release.
2. Exercise a dashboard request and an MCP publish. Inspect the SDK waterfall:
   Web/MCP client spans and API/Upload receiver spans should share a trace ID,
   with receiver parent IDs matching the forwarding client spans.
3. Follow publish into bundle/safety processing. Each message should resume its
   producing trace independently. A retry or bundle DLQ delivery retains that
   trace; a mixed batch must not merge unrelated messages.
4. Confirm sampled and unsampled parent decisions survive the boundaries, and
   sanitized warning/error logs remain linked to their processing spans.
5. Confirm `service.name`, environment, and release identify the SDK spans. Check
   that credentials, capability hosts, upload tokens, and arbitrary baggage are
   absent from exported payloads. POST bodies, cookies, query strings, and
   sensitive request headers must also be absent from transaction envelopes.

The local SDK regression tests cover parentage, sampling inheritance, batch
isolation, retries, legacy messages, and sanitization using the pinned SDK and
an in-memory transport. Hosted checks establish delivery after deployment.

Cloudflare's native tracing currently [does not propagate context to external
services](https://developers.cloudflare.com/workers/observability/traces/known-limitations/),
and its [custom-span API does not expose trace/span
IDs](https://developers.cloudflare.com/workers/observability/traces/custom-spans/#limitations).
Native and SDK traces can coexist in Sentry, but should not be represented as
one automatically joined trace. Supported SDK propagation is described in
[Sentry's distributed-tracing documentation](https://docs.sentry.io/platforms/javascript/guides/cloudflare/tracing/distributed-tracing/).

## Audit: 2026-10-04

Read-only Cloudflare inspection covered all eight Workers in standing preview
and production. Axiom and Sentry were queried for the previous seven days.

- All sixteen deployed Worker configs selected `axiom-logs`. The Axiom log and
  trace destinations both reported recent successful exports with no reported
  error. Axiom contained events for the six production native-tracing Workers
  and application logs from Upload. No recent Content application log was found.
- The six native-tracing Workers selected only `axiom-traces`. The account's
  `sentry-agent-paste-traces` destination was enabled but had never reported a
  successful export. The repository change adds that destination to all six.
- Jobs, MCP, and Stream lacked `SENTRY_DSN` in both environments. API, Upload,
  Content, Apex, and Web had a binding. The workflows did not pass a DSN, Web
  was missing from DSN secret routing, and PR preview secrets omitted the DSN.
  The repository change fixes those paths.
- GitHub secret-name inspection found no `SENTRY_DSN` at repository level or in
  either deployment environment at the start of the audit. After the user
  supplied the DSN and authorized setup, `SENTRY_DSN` was configured in GitHub
  `Preview` and `Production` and verified by secret metadata. Deployment must
  still provision the missing Worker bindings.
- MCP's SDK sample rate was `0.1`, while the shared default was `1`. The
  repository change aligns MCP to avoid dropping downstream trace segments.
- Generated PR configs used only `observability.enabled`, losing destinations
  and re-enabling invocation logs on Content/Upload. They now inherit the
  checked-in settings.
- Sentry contained production HTTP, database, and queue-publish spans. This
  confirms existing SDK ingestion, not coverage of Workers without a DSN.

No hosted Worker settings or production application resources were changed by
this audit. The authorized follow-up configured the GitHub environment DSN
secrets only. The repository fixes require deployment and a repeat delivery check.
Content/Upload traces still have no Axiom path; meeting that requirement requires
a separate exporter that sanitizes spans before sending them to Axiom.
