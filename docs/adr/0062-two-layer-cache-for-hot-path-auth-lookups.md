# Two-Layer Cache for Hot-Path Auth Lookups

Every authenticated request hits storage to resolve actor identity, **Scopes**, and **Workspace** state before any business logic runs: `api` and `upload` parse an `ap_pk_{env}_{publicId}_{secret}` bearer per [ADR 0043](./0043-bearer-credential-format-and-storage.md) and look up the row by `publicId` through Hyperdrive, plus the **Workspace** **Usage Policy** snapshot from [ADR 0056](./0056-mvp-usage-policy-defaults-and-platform-caps.md); `content` performs up to four parallel KV reads against the denylist per request per [ADR 0057](./0057-kv-denylist-namespace-keys-and-write-order.md). Workers KV reads are billed per `.get()` call regardless of the per-call `cacheTtl`, and Hyperdrive reads consume connection-pool budget; left unmitigated this pre-auth path dominates per-request cost for the high-traffic case where one **Workspace** sends millions of requests but few of them mutate state. This ADR commits the three production hot paths (`api`, `upload`, `content`) to a two-layer cache in front of all auth-time lookups: **L1** is a module-scope `Map` per V8 isolate (zero I/O, zero billing); **L2** is the Workers Cache API per Cloudflare colo (no per-op billing, ephemeral, survives isolate recycling). Reads fall through L1 → L2 → KV/Postgres on miss, populating both layers on the way back. Anything that must atomically increment (per-actor rate limits, **Workspace Burst Cap**, idempotency record creation) bypasses both layers and goes straight to its authoritative store.

## Considered Options

- **No caching beyond Cloudflare's edge.** Simpler, but KV's edge cache reduces latency, not billing — every `.get()` is metered even on a hot key. At one million authenticated requests per day from one **Workspace**, the auth lookup alone outweighs the queue, R2, and Postgres-write paths combined.
- **Single-layer Cache API.** Covers most misses and has no per-op billing, but every hit deserializes a synthetic `Response` body; the module-scope Map handles the burst case (many requests per second from the same actor in the same isolate) at zero cost and zero deserialize. Two layers compose; either layer alone is a regression for one half of the traffic shape.
- **Single-layer module-scope Map.** Zero cost on hit, but isolates are evicted on resource pressure and deploys. Every recycle in a hot colo turns into a billed KV/Postgres read with no backstop.
- **Cache the rate-limit decision itself.** The Durable Object call from [ADR 0039](./0039-authenticated-rate-limits-under-usage-policy.md) is the counter increment, not a side-effect-free lookup. Caching "allowed" skips the counter and the cap silently breaks. Only _terminal_ results (`exceeded`, `error`, `billing_not_active`) are safe to cache because they do not need an increment to remain correct.

## Consequences

### What is cached

| Lookup                                                                                                                                                    | Worker                  | Source                  | TTL  | Why it is safe                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API Key** _failed_ verify by secret hash (malformed, revoked, expired, or bad HMAC)                                                                     | `api`, `upload`         | Postgres via Hyperdrive | 60 s | Successful verifies are never cached so revocation and expiry always re-hit Postgres; only negative results are cached to absorb brute-force traffic without extending credential lifetime. |
| **Workspace** billing state and **Usage Policy** snapshot                                                                                                 | `api`, `upload`, `jobs` | Postgres via Hyperdrive | 60 s | Tier and policy changes are infrequent; 60 s is the agreed propagation budget for everything that is not handled by the denylist.                                                           |
| Denylist _negative_ result for `wsd:`, `ad:`, `rd:`, `ald:` keys                                                                                          | `content`               | KV per ADR 0057         | 60 s | Positive results are _not_ cached so revocation propagates inside the 15-minute content-token window from [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md).        |
| **Workspace Member** session resolution on `api` after the `web` service-binding hop per [ADR 0059](./0059-web-app-session-and-auth-forwarding-to-api.md) | `api`                   | WorkOS + Postgres       | 60 s | The WorkOS signature check runs before the cache layer; the cache stores the resolved member row.                                                                                           |
| Terminal **Actor Rate Limit** / **Workspace Burst Cap** results (`exceeded`, `error`, `billing_not_active`) per ADR 0039                                  | `api`, `upload`         | Per-actor counter store | 60 s | No counter increment is needed once the actor is over a terminal threshold; the first request to cross it still increments.                                                                 |

### What is never cached

- Counter increments for **Actor Rate Limit** and **Workspace Burst Cap**. Every authorized request reaches the authoritative counter.
- Idempotency record creation per [ADR 0035](./0035-runcommand-sequencing-and-idempotency-records.md). The race the record exists to prevent occurs at create time.
- _Positive_ denylist hits per ADR 0057. Caching a denial would extend the revocation window past the content-token TTL and weaken the consistency contract.
- The HMAC verify result for an **API Key**. The compare is one SHA-256 and depends on the row's `hmac_kid` plus the per-environment pepper; caching the verify trades microseconds for a credential-confusion risk.

### Cache layout

- **L1 — Module-scope `Map<string, CacheEntry>`** declared at the top of the auth module in each Worker. Entries carry `{value, expiresAt}`; expired entries are evicted on read. The Map is bounded to 1000 entries (LRU by insertion order) so an unbounded key space cannot push the isolate into memory pressure.
- **L2 — `caches.default`** keyed by a synthetic `Request` URL of shape `https://cache.agent-paste.internal/{namespace}/{key}` with `Cache-Control: max-age={ttl}` on the stored `Response`. The synthetic origin is unreachable from outside; only the colocated Worker reads or writes it.
- **Fall-through.** Miss in L1 → check L2 → on hit populate L1; on miss read the source, populate both. Errors during cache writes are swallowed so a transient Cache API hiccup never blocks a request from reaching the source of truth.
- **Shared helper.** `packages/auth` exports a `cachedLookup(namespace, key, ttl, fetcher)` so every Worker uses the same layered helper and the same eviction rules. Bespoke per-Worker caches are a regression.

### Verification

- Development-only response header `X-AgentPaste-Auth-Cache: l1-hit | l2-hit | source` on `api`, `upload`, and `content` so manual load tests confirm the layer breakdown without log scraping.
- Operational logs per [ADR 0011](./0011-cloudflare-first-observability.md) carry the cache layer on every auth event so cache-hit ratios are observable.
- Integration tests cover four cases per cached lookup: cold (source), warm L1, warm L2 after isolate-recycle simulation, and TTL expiry triggering re-fetch.

### Worker scope

- Hot-path lookups in `api`, `upload`, and `content` adopt the two-layer pattern from day one. Retrofitting after handlers exist is meaningfully harder than starting with the layered helper.
- `web` and `jobs` are not hot-path auth surfaces and use the simpler single-source read; the helper exists for opt-in if a future handler proves hot.
- `mcp` per [ADR 0061](./0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) verifies its JWT locally and forwards to `api` over a service binding; the auth cache lives behind that boundary on `api`, not on `mcp`.

### Trade-offs accepted

- Up to 60 s between an **API Key Revocation**, a **Usage Policy** change, or a **Workspace** billing-state change and the cached actor seeing the new state. This is the operational propagation budget. Emergency revocation paths (**Platform Lockdown**, **Access Link Lockdown**) use the denylist write order from ADR 0057 to enforce instant takedown on the content surface, independent of this cache.
- L1 hit rate drops on deploys and isolate evictions; L2 catches those misses inside the same colo at zero billing cost. Cross-colo misses fall through to the source as designed.
- This ADR does not introduce a new glossary term. The cache is implementation detail behind the existing actor and policy lookups.
