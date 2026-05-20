# MVP Usage Policy Defaults and Platform Caps

Concrete numeric values for upload caps, rate limits, TTLs, and lifecycle limits referenced as platform-controlled by [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md), [ADR 0039](./0039-authenticated-rate-limits-under-usage-policy.md), [ADR 0041](./0041-upload-size-caps-under-usage-policy.md), [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md), and [ADR 0048](./0048-transient-artifacts-by-default.md). Workspace-tunable settings cannot exceed the platform cap; platform-controlled values are not exposed through **Usage Policy**.

## Values

| # | Setting | Value | Class | Enforcing surface | Source ADR |
|---|---|---|---|---|---|
| 1 | File Size Cap | 25 MB | platform cap | `upload` signed PUT `Content-Length` | [0041](./0041-upload-size-caps-under-usage-policy.md) |
| 2 | File Count Cap | 500 files / **Revision** | platform cap | **Upload Session** create + finalize | [0041](./0041-upload-size-caps-under-usage-policy.md) |
| 3 | Revision Size Cap | 100 MB / **Revision** | platform cap | **Upload Session** create + finalize | [0041](./0041-upload-size-caps-under-usage-policy.md) |
| 4 | Bundle Size Cap | 100 MB / **Bundle** | platform cap | `jobs` bundle generator | [0041](./0041-upload-size-caps-under-usage-policy.md) |
| 5 | Actor Rate Limit | 60 req/min per **API Key** or **Workspace Member** | platform cap | `api` + `upload` middleware | [0039](./0039-authenticated-rate-limits-under-usage-policy.md) |
| 6 | Workspace Burst Cap | 300 req/min aggregate per **Workspace** | platform cap | `api` + `upload` middleware | [0039](./0039-authenticated-rate-limits-under-usage-policy.md) |
| 7 | Artifact Rate Limit | 60 req/min unauthenticated reads per **Artifact** | platform-controlled | `content` + Access Link resolve | [0048](./0048-transient-artifacts-by-default.md) |
| 8 | Content-gateway token TTL | 15 minutes | platform-controlled | `api` mints, `content` verifies | [0028](./0028-signed-url-tokens-for-content-gateway-authorization.md) |
| 9 | Access Link Signed URL `exp` default | `min(row.expires_at, now + 24h)` | platform-controlled | `api` mint endpoint | [0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md) |
| 10 | Upload Session TTL | 24 hours | platform-controlled | `upload` + `jobs` cleanup | this ADR |
| 11 | Pinned Artifact cap | 50 / **Workspace** | platform cap | `api` pin endpoint | [0048](./0048-transient-artifacts-by-default.md) |
| 12 | Auto Deletion default | 30 days since last **Publish** | workspace default | `jobs` retention sweep | [0048](./0048-transient-artifacts-by-default.md) |
| 13 | Auto Deletion platform cap | 90 days | platform cap | `api` settings validation | this ADR |
| 14 | Audit Retention | 180 days | platform-controlled | `jobs` audit sweep | this ADR |
| 15 | Signing-key rotation cadence | 90 days | platform-controlled | scheduled remote agent | [0045](./0045-secret-rotation-cadence-and-on-demand-tooling.md) |

## Workspace-default Usage Policy

A new **Workspace** is initialized with:

- File Size Cap, File Count Cap, Revision Size Cap, Bundle Size Cap pinned at the platform caps above.
- Actor Rate Limit and Workspace Burst Cap pinned at the platform caps above.
- Auto Deletion set to 30 days (the workspace default).
- **Bundle Availability** enabled — every published **Revision** gets a **Bundle**, subject to Bundle Size Cap.
- **Access Link** creation enabled.

A **Workspace Member** can lower Auto Deletion below 30 days; they cannot raise it above 90 days. Other workspace-tunable knobs land post-MVP.

## Sanity checks

- 500 files at the per-file 25 MB cap would be 12.5 GB; the 100 MB Revision cap blocks the worst case. Caps stack from per-PUT to per-Revision-finalize.
- A leaked **Access Link Signed URL** can mint at most ~96 content-gateway tokens (24h ÷ 15min) before its own `exp` retires it.
- A 60 req/min **Artifact Rate Limit** caps unauthenticated read amplification at 86,400/day per artifact, well below realistic CDN-fronted budgets.
- Workspace Burst Cap (300/min) is 5× Actor Rate Limit, allowing several concurrent agents in one **Workspace** without tripping.

## Why these specific numbers

- **Caps are conservative.** It is operationally cheap to raise a number after MVP, expensive to lower one. We default low and tune up.
- **Tier-style flexibility is deferred.** The MVP exposes one **Usage Policy** shape with these defaults; per-workspace overrides for things like Auto Deletion ride on existing infrastructure.
- **No number is platform-secret.** All values can be returned through a public `GET /v1/usage-policy` so agents can plan around them.

## What is not in this ADR

- Cost / billing tiers. Out of MVP scope.
- Per-render-mode caps. **Render Modes** share one set of caps.
- Per-workspace overrides beyond Auto Deletion. Workspaces accept platform caps in the MVP.
