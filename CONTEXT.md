# Agent Artifact Sharing

A platform for agents to publish shareable work products that can be viewed online by humans or consumed by other agents.

## Language

Each glossary entry carries an HTML anchor. ADRs and specs deep-link with `[Term](./CONTEXT.md#term-slug)` where the slug is kebab-case of the term name. Anchor convention applies to entries in the `## Language` and `## Apps and Workers` sections.

<a id="artifact"></a>
**Artifact**:
A durable, addressable folder-like package containing one or more uploaded files or rendered assets.
_Avoid_: Paste, single blob, post

<a id="unpublished-artifact"></a>
**Unpublished Artifact**:
An **Artifact** that has management state but no **Published Revision**.
_Avoid_: Empty artifact, draft artifact

<a id="revision"></a>
**Revision**:
A saved state of an **Artifact** after creation or update.
_Avoid_: Version, snapshot

<a id="draft-revision"></a>
**Draft Revision**:
A **Revision** that has been uploaded but is not yet visible through stable **Artifact** links.
_Avoid_: Partial update, pending files

<a id="published-revision"></a>
**Published Revision**:
The **Revision** currently visible through stable **Artifact** links.
_Avoid_: Live version, current snapshot

<a id="live-update"></a>
**Live Update**:
The behavior by which an already-open **Private Link** or **Share Link** viewer advances to the latest **Published Revision** without a manual reload. A **Live Update** occurs only when a new **Revision** is **Published** and never reveals a **Draft Revision**. A viewer that has fallen behind reconciles to the current **Published Revision** rather than replaying the **Revisions** it missed.
_Avoid_: Live edit, real-time sync, hot reload, watch mode

<a id="upload-session"></a>
**Upload Session**:
A temporary workflow for collecting files that will become a complete **Revision** when finalized.
_Avoid_: Upload batch, direct upload, pending upload

<a id="revision-link"></a>
**Revision Link**:
An **Access Link** that resolves to one specific **Revision** of an **Artifact**.
_Avoid_: Historical share link, frozen artifact link

<a id="bundle"></a>
**Bundle**:
A downloadable archive generated from a complete **Revision** file tree.
_Avoid_: Export, zip

<a id="bundle-availability"></a>
**Bundle Availability**:
The state of a **Bundle** for a **Revision**: pending while being generated, ready when retrievable, failed when generation reached a permanent error, or disabled when **Usage Policy** does not permit a **Bundle**.
_Avoid_: Bundle status, bundle state

<a id="workspace"></a>
**Workspace**:
The tenant that owns **Artifacts**, members, and agent credentials.
_Avoid_: Account, organization, project

<a id="personal-workspace"></a>
**Personal Workspace**:
The default **Workspace** created for an individual human user.
_Avoid_: Personal account, user workspace

<a id="workspace-member"></a>
**Workspace Member**:
A human user with authenticated access to a **Workspace**.
_Avoid_: Teammate, collaborator

<a id="audit-event"></a>
**Audit Event**:
A platform-controlled record of a security-relevant or lifecycle change within a **Workspace**.
_Avoid_: Log line, activity item

<a id="audit-retention"></a>
**Audit Retention**:
The platform-controlled rules that determine how long **Audit Events** are kept.
_Avoid_: Usage policy retention, log cleanup

<a id="change-summary"></a>
**Change Summary**:
The redacted structured description of what changed in an **Audit Event**.
_Avoid_: Before-and-after payload, raw diff

<a id="usage-policy"></a>
**Usage Policy**:
The limits a **Workspace** applies to artifact creation, retention, auto deletion, access-link creation, **File Size Cap**, **File Count Cap**, **Revision Size Cap**, **Bundle Size Cap**, **Actor Rate Limit**, and **Workspace Burst Cap**.
_Avoid_: Quota settings, billing limits

<a id="file-size-cap"></a>
**File Size Cap**:
The cap on bytes per single file uploaded into a **Revision**. Platform-controlled in the MVP and surfaced through **Usage Policy**.
_Avoid_: Max file size, upload limit

<a id="file-count-cap"></a>
**File Count Cap**:
The cap on the number of files in a single **Revision**. Platform-controlled in the MVP and surfaced through **Usage Policy**.
_Avoid_: Max files, file quota

<a id="revision-size-cap"></a>
**Revision Size Cap**:
The cap on the sum of file bytes in a single **Revision**. Platform-controlled in the MVP and surfaced through **Usage Policy**.
_Avoid_: Revision quota, artifact size

<a id="bundle-size-cap"></a>
**Bundle Size Cap**:
The cap on the bytes of a generated **Bundle**. Platform-controlled in the MVP and surfaced through **Usage Policy**. Exceeding the cap transitions **Bundle Availability** to failed without affecting the **Revision** or the **Publish**.
_Avoid_: Bundle quota, zip size

<a id="retention"></a>
**Retention**:
The **Usage Policy** rule that determines how long older non-published **Revisions** are kept within an **Artifact**.
_Avoid_: Cleanup, pruning, auto deletion

<a id="auto-deletion"></a>
**Auto Deletion**:
The **Usage Policy** rule that triggers **Deletion** on a published **Artifact** after a configured age since its most recent **Publish**.
_Avoid_: Retention, expiration, TTL

<a id="pinned-artifact"></a>
**Pinned Artifact**:
An **Artifact** marked by a **Workspace Member** to exempt it from **Auto Deletion**.
_Avoid_: Favorite, starred, archived, locked

<a id="artifact-rate-limit"></a>
**Artifact Rate Limit**:
The platform-controlled cap on unauthenticated read requests per minute against a single **Artifact** through its **Access Links** and **Content Origin**.
_Avoid_: Throttle, quota, API rate limit

<a id="actor-rate-limit"></a>
**Actor Rate Limit**:
The cap on authenticated request rate per individual actor — one **API Key** or one **Workspace Member** — against `api` and `upload`. Platform-controlled in the MVP and surfaced through **Usage Policy**.
_Avoid_: API rate limit, key throttle

<a id="workspace-burst-cap"></a>
**Workspace Burst Cap**:
The cap on aggregate authenticated request rate across all actors in a single **Workspace** against `api` and `upload`. Platform-controlled in the MVP and surfaced through **Usage Policy**.
_Avoid_: Tenant rate limit, account throttle

<a id="upload-cleanup"></a>
**Upload Cleanup**:
The background removal of stale **Unpublished Artifacts** and bytes left by expired, abandoned, or terminally failed **Upload Sessions**.
_Avoid_: Retention, revision cleanup

<a id="deletion"></a>
**Deletion**:
The action that makes an entire **Artifact** inaccessible before its stored bytes are physically purged.
_Avoid_: Purge, archive, restore

<a id="api-key"></a>
**API Key**:
A credential that lets an agent create and manage **Artifacts** on behalf of a **Workspace**.
_Avoid_: User token, agent token

<a id="api-key-revocation"></a>
**API Key Revocation**:
The action that stops future use of an **API Key** without removing what it already created.
_Avoid_: Delete key, revoke agent content

<a id="api-key-bearer-format"></a>
**API Key Bearer Format**:
The string shape used for **API Key** secrets: `ap_pk_{env}_{publicId}_{secret}`. `pk` is the credential-class marker, `env` matches the deployment environment, `publicId` is the indexed lookup segment stored plaintext, and `secret` is the high-entropy random segment hashed with a Worker-secret pepper for storage. **Access Link** tokens used to share this shape (with `type='al'`) but were moved to the **Access Link Signed URL** model and no longer follow this format.
_Avoid_: Token format, key shape, API key prefix, bearer credential format

<a id="access-link-signed-url"></a>
**Access Link Signed URL**:
The shareable URL form of an **Access Link**, shaped `https://app.agent-paste.sh/al/{publicId}#{blob}` where `blob` is a base64url-encoded binary payload containing the signing-key generation, expiration, allowed scopes, and HMAC signature. The payload is carried in the URL fragment so it never reaches any server-side log, and the signature is the credential — the `access_links` row holds no secret material. An authorized **Workspace Member** or **API Key** with read and share **Scopes** mints a fresh URL on demand; re-minting produces a new URL with a new expiration.
_Avoid_: Share URL, link token, access link secret

<a id="creator"></a>
**Creator**:
The **API Key** or workspace member that first created an **Artifact** management record.
_Avoid_: Owner, author

<a id="scope"></a>
**Scope**:
A named permission that authorizes an actor to perform a class of action within a **Workspace**. A **Workspace Member** is implicitly granted every **Scope** (including **Member-Only Scopes** such as `admin`) only when authenticated for direct workspace control (the dashboard). The CLI does not carry **Scopes** in a token: `agent-paste login` mints an **API Key**, and minted keys are capped at `publish` and `read` (never `admin`), so the CLI surface is structurally below the dashboard ceiling. An **API Key** holds a named subset.
_Avoid_: Role, capability

<a id="member-only-scope"></a>
**Member-Only Scope**:
A **Scope** that only a **Workspace Member** can hold via direct workspace authentication (the dashboard); it cannot be granted to an **API Key** and cannot be carried by tokens issued for delegated agent surfaces such as the CLI or MCP. Member-only **Scopes** authorize **API Key** lifecycle management, **Audit Event** reads, and **Workspace** administration.
_Avoid_: Admin scope, restricted scope

<a id="operator"></a>
**Operator**:
A **Workspace Member** session whose authenticated email appears in the platform operator allowlist; the same identity acts with platform-wide authority on operator-only routes and with normal **Workspace Member** authority elsewhere. The **Operator** identity is the only path to **Platform Lockdown** changes and on-demand storage-key rotation.
_Avoid_: Admin, superuser, root user

<a id="untrusted-content"></a>
**Untrusted Content**:
Any file, markup, script, image, or asset uploaded into an **Artifact**.
_Avoid_: User content, agent output

<a id="safety-warning"></a>
**Safety Warning**:
A non-blocking notice attached to an **Artifact** or **Revision** when uploaded content appears risky.
_Avoid_: Rejection, policy violation

<a id="content-origin"></a>
**Content Origin**:
The isolated web origin where **Untrusted Content** is viewed or fetched.
_Avoid_: App domain, storage URL

<a id="content-gateway-token"></a>
**Content-Gateway Token**:
A short-lived HMAC-signed bearer token, carried in the `content` request path as `/v/{token}/{path}`, that authorizes read access to **Untrusted Content** for one **Revision**. `api` and `upload` mint it; `content` verifies its signature, expiration, and shape, then derives the denylist keys it checks before serving, with no database lookup; the **Workspace**, **Artifact**, and **Revision** identities are read from the verified payload. Carried as the `signed_content_token` auth requirement in the route contract. Distinct from the **Access Link Signed URL**, which is fragment-encoded and resolved by `api` against the database; both share the `base64url(payload).hmac` wire scheme.
_Avoid_: Content token, gateway token

<a id="execution-policy"></a>
**Execution Policy**:
The platform-controlled browser restrictions applied when viewing **Untrusted Content**.
_Avoid_: Sandbox settings, CSP config

<a id="served-content-type"></a>
**Served Content Type**:
The platform-derived MIME type that `content` returns for a file in a **Revision**, chosen from a fixed allowlist by file extension rather than from agent-claimed values. Unrecognized extensions are served as `application/octet-stream` with `Content-Disposition: attachment` so they download rather than render.
_Avoid_: Content-Type header, MIME hint

<a id="entrypoint"></a>
**Entrypoint**:
The file within a **Revision** that opens first when an **Artifact** is viewed. Directory Entrypoints are reserved for future **Directory Render Mode** once its listing contract is settled.
_Avoid_: Homepage, default file, main file

<a id="render-mode"></a>
**Render Mode**:
The platform-supported way an **Entrypoint** is displayed to viewers.
_Avoid_: File type, preview type

<a id="manifest"></a>
**Manifest**:
The machine-readable description of an **Artifact** and a resolved **Revision**. In the MVP, a **Manifest** carries artifact id, revision id, revision number, **Entrypoint**, **Render Mode**, created-at, and **Creator** reference; the file listing, content links, **Display Metadata**, **Safety Warnings**, and **Bundle Availability** are exposed beside the **Manifest** in **Agent View**.
_Avoid_: Metadata blob, config file

<a id="display-metadata"></a>
**Display Metadata**:
Mutable human-facing labels that describe an **Artifact** without changing any **Revision**. In the MVP, **Display Metadata** is a required title and an optional description, both plain text.
_Avoid_: Manifest metadata, title fields, revision metadata, markdown metadata

<a id="private-link"></a>
**Private Link**:
The authenticated URL for reading an **Artifact** within its owning tenant.
_Avoid_: Admin link, dashboard link

<a id="access-link"></a>
**Access Link**:
A revocable, unlisted, high-entropy URL for reading an **Artifact** without tenant authentication.
_Avoid_: Public link, capability URL

<a id="access-link-lockdown"></a>
**Access Link Lockdown**:
A state that makes all **Access Links** for an **Artifact** stop granting access without affecting its **Private Link**.
_Avoid_: Disable sharing, private mode, emergency revoke

<a id="platform-lockdown"></a>
**Platform Lockdown**:
A platform-initiated state that blocks all link resolution for either a single **Artifact** or an entire **Workspace**, applied by the operator to respond to abuse reports, takedown requests, or external safety flags. A **Workspace**-scoped **Platform Lockdown** also suspends every **API Key** in the **Workspace**.
_Avoid_: Suspension, ban, freeze, admin lock

<a id="share-link"></a>
**Share Link**:
An **Access Link** that resolves to the latest **Published Revision** of an **Artifact**.
_Avoid_: Public link, permalink, latest link

<a id="expiration"></a>
**Expiration**:
The optional time after which a time-limited credential, link, or workflow stops being usable.
_Avoid_: TTL, timeout

<a id="agent-view"></a>
**Agent View**:
The machine-readable read surface that exposes an **Artifact**'s **Manifest**, file listing, content links, **Display Metadata**, and **Safety Warnings**.
_Avoid_: API preview, metadata endpoint

<a id="agent-view-token"></a>
**Agent-View Token**:
A short-lived HMAC-signed bearer token that authorizes unauthenticated read of one **Revision**'s **Agent View** through `api`'s public agent-view route. `api` and `upload` mint it; `api` verifies it on resolve. It shares the **Content-Gateway Token**'s `base64url(payload).hmac` wire scheme and signing-secret family but resolves on `api` rather than the **Content Origin**, and is carried as the `signed_agent_view_token` auth requirement in the route contract.
_Avoid_: Agent token, view token

<a id="publish"></a>
**Publish**:
The agent-facing action that creates or updates an **Artifact** and makes a complete **Revision** visible.
_Avoid_: Upload, deploy

<a id="publish-result"></a>
**Publish Result**:
The response returned after **Publish**, containing identifiers, human-view links, agent-view links, and warnings.
_Avoid_: Upload response, API response

## Apps and Workers

The platform is a small set of deployable units. ADRs reference these by name; this section is the glossary anchor so future docs and conversations share one vocabulary for which surface owns what.

<a id="api"></a>
**api**:
The Worker that owns authenticated mutations, **Workspace** state changes, **Publish** coordination, **Access Link** minting, **Display Metadata** updates, denylist writes, and operator routes. Holds the Hyperdrive binding to Postgres, a queue-producer binding, KV write on the denylist, and R2 read for verification only. The only path to durable business writes.
_Avoid_: backend, control plane, server worker

<a id="upload"></a>
**upload**:
The Worker that owns the R2 write path for **Untrusted Content**. It creates **Upload Sessions**, mints short-lived signed upload-worker PUT URLs for reserved final keys, encrypts bytes before writing to R2, and verifies finalize. The only Worker with R2 PUT capability for **Revision** files.
_Avoid_: ingest worker, writer worker

<a id="content"></a>
**content**:
The Worker on the isolated **Content Origin** that verifies short-lived content-gateway tokens, checks the KV denylist, decrypts bytes, and streams **Revision** files and **Bundles** to viewers. Holds R2 read and KV read bindings only; no Hyperdrive, no mutation authority.
_Avoid_: content gateway, asset worker, viewer worker

<a id="jobs"></a>
**jobs**:
The Worker that consumes Cloudflare Queues and runs **Bundle** generation, **Safety Warning** scanning, **Retention**, **Upload Cleanup**, **Deletion** byte purge, and cron rediscovery. Holds Hyperdrive, R2 read/write, KV write on the denylist, and queue-consumer bindings.
_Avoid_: workers (plural), background worker, cron worker

<a id="web"></a>
**web**:
The Worker that serves the TanStack Start dashboard, terminates **Workspace Member** sessions, and forwards authenticated requests to `api` over a **Service Binding**. Holds no Postgres, no R2, no KV bindings; auth state flows through `api`.
_Avoid_: frontend worker, dashboard worker, app worker

<a id="stream"></a>
**stream**:
The Worker that owns the per-**Artifact** **Live Update** channel. It holds a Durable Object that fans out **Published Revision** pointers to connected **Private Link** and **Share Link** viewers over a held streaming connection, and it authorizes each connection by forwarding the viewer's **Access Link** credential or **Workspace Member** session to `api` over a **Service Binding**. Holds no Postgres, no R2, and no KV; carries no secrets and serves no **Untrusted Content**. `api` notifies it on **Publish**.
_Avoid_: sse worker, push worker, realtime gateway

<a id="cli"></a>
**cli**:
The local `agent-paste` command-line tool. Not a Worker; runs on the developer or agent machine and talks to `api` and `upload` over HTTPS. `agent-paste login` runs a WorkOS loopback PKCE flow (against a dedicated Public OAuth Connect app) that mints and stores a scoped **API Key**, then discards the WorkOS token (ADR 0060); `AGENT_PASTE_API_KEY` remains the path for CI and headless agents and takes precedence over the stored key.
_Avoid_: client, sdk, ap tool

<a id="mcp"></a>
**mcp**:
The Worker on `mcp.agent-paste.sh` that terminates OAuth-only Model Context Protocol requests and forwards them to `api` over a **Service Binding**. Owns no Postgres, no R2, no business logic; the trust boundary is "verify the bearer, forward to `api`."
_Avoid_: mcp server, mcp endpoint, agent endpoint

<a id="service-binding"></a>
**Service Binding**:
A typed Cloudflare Workers binding that lets one Worker call another inside the Cloudflare network without a public HTTP round-trip. Used for `web → api` and `mcp → api`. The downstream Worker re-verifies the bearer rather than trusting the upstream Worker blindly.
_Avoid_: internal API, worker RPC, internal call

## Runtime primitives

<a id="route-contract"></a>
**Route Contract**:
The declarative record for one HTTP route, owned by `packages/contracts`: its app, method, path, auth requirement, required **Scope**s, rate-limit class, idempotency requirement, request/response schema names, and error codes. Historically read only by OpenAPI generation; the **Route Registrar** makes it the single source the runtime reads to enforce auth, scopes, rate limiting, and idempotency.
_Avoid_: route config, endpoint spec, handler metadata

<a id="signed-token-codec"></a>
**Signed Token Codec**:
The shared wire scheme and verification discipline for every HMAC-signed bearer token the platform mints: `base64url(JSON.stringify(payload)) + "." + base64url(hmac)`. One implementation in `packages/tokens` mints and verifies the **Content-Gateway Token**, the **Agent-View Token**, and the upload PUT signed-URL token; each has its own signing secret and payload shape but shares the codec. Verification checks signature, shape, and expiration together and returns the typed payload or nothing, never throwing.
_Avoid_: token format, HMAC helper, sign/verify util

<a id="route-registrar"></a>
**Route Registrar**:
The `packages/worker-runtime` module that mounts a **Route Contract** onto a Worker: it reads the contract, runs the **Request Guard**, then calls the handler with the resolved principal and the repository, except on `content`, which has no database. Replaces the per-Worker inlined guard chains and the `withWebMember` wrapper.
_Avoid_: router, route factory, mount helper

<a id="request-guard"></a>
**Request Guard**:
The uniform pre-handler chain the **Route Registrar** runs for every route, derived from the **Route Contract**: resolve the principal for the auth requirement, apply the rate-limit class, check **Scope**s, shape the `Idempotency-Key` header outcome, and render failures into the fixed error envelope. The only per-Worker seam is the auth resolver set; everything else is a pure function. The durable idempotency claim stays inside `runCommand`, not the guard.
_Avoid_: middleware, interceptor, auth filter

## Relationships

- An **Artifact** contains one or more files or rendered assets
- A **Revision** has exactly one **Entrypoint**
- A **Revision** has exactly one **Render Mode**
- **Entrypoint** and **Render Mode** are inferred when obvious and can be overridden during **Publish**
- **Publish** fails when an **Entrypoint** or **Render Mode** override cannot be applied to the **Revision**
- MVP file **Render Modes** are HTML, Markdown, text, image, audio, and video; directory is reserved pending a listing contract
- A published **Artifact** has exactly one **Manifest** for each resolved **Revision**
- An **Unpublished Artifact** has no **Manifest**
- An **Artifact** can have zero or more **Revisions**
- A published **Artifact** has one or more **Revisions**
- An **Unpublished Artifact** has no **Published Revision**
- An **Artifact** has zero or one **Draft Revisions**
- An **Artifact** has exactly one **Published Revision** after first publish
- An **Artifact** can have zero or more **Upload Sessions**
- A **Revision** is a complete immutable file tree
- An **Upload Session** prepares exactly one **Revision**
- An **Upload Session** can be created while a **Draft Revision** already exists
- Finalizing an **Upload Session** creates a **Draft Revision**
- Only one finalized **Draft Revision** can wait for **Publish** on an **Artifact**
- Finalizing an **Upload Session** fails when another **Draft Revision** is already waiting for **Publish**
- **Draft Revisions** are visible to **Workspace Members** in management surfaces
- **Draft Revisions** are visible to **API Keys** with write **Scope**
- A read **Scope** does not grant access to **Draft Revisions**
- **API Keys** with write **Scope** can discard **Draft Revisions**
- Discarding a **Draft Revision** does not affect the **Published Revision**
- **Private Links** and **Access Links** never resolve to **Draft Revisions**
- **Private Links** and **Access Links** do not resolve for an **Unpublished Artifact**
- An **Upload Session** can be abandoned before its **Revision** is published
- An **Upload Session** has an **Expiration**
- **Upload Cleanup** removes stale **Unpublished Artifacts** and bytes left by expired, abandoned, or terminally failed **Upload Sessions**
- **Upload Cleanup** is platform-controlled, not governed by **Usage Policy**
- **Publish** makes a complete **Revision** the **Published Revision**
- **Publish** is the only action that makes a **Revision** externally visible
- A **Revision** can be retrieved as a **Bundle**
- A **Bundle** has exactly one **Bundle Availability**
- A **Bundle** can become available after **Publish** completes
- **Usage Policy** controls whether a **Bundle** is available for a **Revision**
- **Usage Policy** sets **Bundle Availability** to disabled at **Publish** when **Bundles** are not permitted
- A pending **Bundle Availability** transitions to ready when generation completes or failed when generation reaches a permanent error
- A failed **Bundle Availability** does not transition automatically
- An **Artifact** belongs to exactly one **Workspace**
- An **Artifact** can have zero or more **Access Links**
- A **Private Link** resolves to the latest **Published Revision** of an **Artifact**
- A **Private Link** cannot be pinned to an older **Revision**
- A **Private Link** grants authenticated read access to human views and the **Agent View**
- A **Private Link** is not an **Access Link**
- A **Live Update** advances an open **Private Link** or **Share Link** viewer to the latest **Published Revision** without a manual reload
- A **Live Update** occurs only when a new **Revision** is **Published** and never reveals a **Draft Revision**
- A **Revision Link** never receives a **Live Update** because it is pinned to one **Revision**
- A viewer that has fallen behind reconciles to the current **Published Revision** on reconnect rather than replaying missed **Revisions**
- **Share Links** and **Revision Links** are **Access Links**
- An **Access Link** grants unauthenticated read-only access to the **Agent View** and published **Untrusted Content**
- An **Access Link** has no **Expiration** unless one is set
- An **Access Link** can be revoked individually
- An **Artifact** can enter **Access Link Lockdown**
- **Access Link Lockdown** disables all **Access Links** for an **Artifact** without affecting its **Private Link**
- **Access Link Lockdown** applies to one **Artifact**, not an entire **Workspace**
- **Access Link Lockdown** can be lifted without restoring revoked or expired **Access Links**
- **Access Link Lockdown** has no **Expiration** in the MVP
- **Access Link Lockdown** prevents creating new **Access Links** for an **Artifact**
- **Access Link Lockdown** prevents retrieving full **Access Link** URLs without hiding **Access Link** metadata from authorized management surfaces
- **Access Link Lockdown** does not prevent revoking individual **Access Links**
- **Access Link Lockdown** does not prevent changing **Access Link** **Expiration**
- A **Platform Lockdown** is operator-initiated and cannot be set or lifted by a **Workspace Member** or an **API Key**
- A **Platform Lockdown** has scope `Artifact` or `Workspace`
- A **Platform Lockdown** at `Artifact` scope blocks the **Private Link** and every **Access Link** for one **Artifact**
- A **Platform Lockdown** at `Workspace` scope blocks the **Private Link** and **Access Link** resolution for every **Artifact** in the **Workspace**
- A **Platform Lockdown** at `Workspace` scope suspends every **API Key** in the **Workspace**
- A **Platform Lockdown** is reversible by the operator
- A **Platform Lockdown** does not delete bytes or **Revisions**
- A **Platform Lockdown** does not auto-expire in the MVP
- A **Platform Lockdown** creates an **Audit Event** visible to **Workspace Members**
- A **Platform Lockdown** is not exposed through the public API, SDK, or CLI
- A **Platform Lockdown** is distinct from **Access Link Lockdown**: it is operator-initiated, also blocks the **Private Link**, and at `Workspace` scope suspends **API Keys**
- An **Operator** is a **Workspace Member** whose authenticated email is on the platform operator allowlist
- An **Operator** acts with platform-wide authority only on operator-only routes; on every other route the identity is a normal **Workspace Member**
- An **Operator** identity cannot be assumed by an **API Key**: operator-only routes reject **API Key** authentication
- An **Operator** identity is reachable only through the web admin surface; the CLI exposes no operator-only commands
- An **Operator** action on operator-only routes is the `actor.type = 'platform'` actor in the **Audit Event**
- A **Platform Lockdown** can only be set or lifted by an **Operator**
- A **Share Link** resolves to the latest **Published Revision** of an **Artifact**
- A **Revision Link** resolves to exactly one **Revision**
- A **Revision Link** can continue resolving to an older **Revision** after a newer **Revision** is published
- A **Revision Link** can be revoked without deleting its **Revision**
- **Retention** can make a **Revision Link** stop resolving without revoking it
- **Publish** creates a **Revision Link** for the published **Revision**
- **Publish** fails if **Usage Policy** prevents creating the required **Revision Link**
- **Publish** fails while an **Artifact** is in **Access Link Lockdown**
- **Revision Links** are not created for **Draft Revisions**
- **Share Links** always resolve to the latest **Published Revision**
- Additional **Revision Links** can be created for an already published **Revision**
- Additional **Revision Links** can target any retained published **Revision**
- **Publish** does not create a **Share Link** unless sharing is requested
- **Publish** fails if a requested **Share Link** cannot be created
- A **Share Link** can be created during **Publish** or after **Publish**
- A **Publish Result** always includes a **Private Link** and the created **Revision Link**
- A **Publish Result** includes a **Share Link** only when one is created during **Publish**
- A **Publish Result** includes separate human-view links and agent-view links
- A **Publish Result** includes **Bundle Availability** even when the **Bundle** is not ready
- A **Workspace** has exactly one **Usage Policy**
- A **Usage Policy** controls **Retention**
- A **Usage Policy** controls **Access Link** creation
- A **Usage Policy** can prevent new **Access Links** across a **Workspace**
- **Usage Policy** changes do not revoke existing **Access Links** unless a durable enforcement action does so
- A **Usage Policy** controls **Unpublished Artifact** creation
- **Usage Policy** applies at the **Workspace** level, not per **Artifact**
- **Retention** keeps all **Revisions** unless limited by policy
- **Retention** is the only MVP path for removing individual **Revisions**
- **Retention** cannot remove the **Published Revision**
- **Retention** makes removed **Revisions** unavailable before their bytes are purged asynchronously
- A **Usage Policy** controls **Auto Deletion**
- **Auto Deletion** applies only to published **Artifacts**
- **Auto Deletion** counts age from the **Artifact**'s most recent **Publish**
- **Auto Deletion** triggers **Deletion** when an **Artifact** reaches its configured age
- **Auto Deletion** has a platform cap that **Workspace** settings cannot exceed
- **Auto Deletion** does not apply to **Unpublished Artifacts**
- **Upload Cleanup** handles unpublished artifact lifecycle; **Auto Deletion** does not
- **Auto Deletion** is separate from **Retention**
- **Deletion** triggered by **Auto Deletion** creates an **Audit Event**
- A **Workspace Member** can pin an **Artifact** to create a **Pinned Artifact**
- A **Pinned Artifact** is exempt from **Auto Deletion**
- **Pinning** and unpinning create **Audit Events**
- **Pinning** is a dashboard-only action; **API Keys** cannot pin regardless of **Scope**
- A **Workspace** has a platform-controlled cap on **Pinned Artifacts**
- **Pinning** is rejected when the **Workspace** is at its **Pinned Artifact** cap
- **Pinning** does not affect **Retention**
- **Pinning** does not affect **Access Link Lockdown**
- An **Artifact Rate Limit** applies per **Artifact**, counted across **Access Link** reads and **Content Origin** requests
- An **Artifact Rate Limit** does not count **Private Link** or **Agent View** reads
- An **Artifact Rate Limit** returns HTTP 429 with `Retry-After` when exceeded
- An **Artifact Rate Limit** is platform-controlled, not exposed through **Usage Policy** in the MVP
- An **Actor Rate Limit** applies per **API Key** or per **Workspace Member**, counted across `api` and `upload` requests
- An **Actor Rate Limit** returns HTTP 429 with `Retry-After` when exceeded
- A **Workspace Burst Cap** applies per **Workspace**, counted across all of its actors against `api` and `upload`
- A **Workspace Burst Cap** returns HTTP 429 with `Retry-After` when exceeded
- A **Usage Policy** controls **Actor Rate Limit** and **Workspace Burst Cap**
- **Actor Rate Limit** and **Workspace Burst Cap** are platform-controlled in the MVP; **Workspace** settings cannot exceed them
- **Actor Rate Limit** and **Workspace Burst Cap** apply only after authentication succeeds
- **Actor Rate Limit** and **Workspace Burst Cap** do not apply to `content`
- A **Usage Policy** controls **File Size Cap**, **File Count Cap**, **Revision Size Cap**, and **Bundle Size Cap**
- **File Size Cap**, **File Count Cap**, **Revision Size Cap**, and **Bundle Size Cap** are platform-controlled in the MVP; **Workspace** settings cannot exceed them
- **File Size Cap** is enforced through the signed upload-worker PUT URL `Content-Length` header at upload time
- **File Count Cap** and **Revision Size Cap** are enforced at **Upload Session** creation as a pre-flight and at finalize as hard enforcement
- Exceeding **File Count Cap** or **Revision Size Cap** at finalize fails the finalize
- **Bundle Size Cap** is enforced during **Bundle** generation
- Exceeding **Bundle Size Cap** transitions **Bundle Availability** to failed without affecting the **Revision** or **Publish**
- **Deletion** makes **Private Links** and **Access Links** stop resolving immediately
- **Deletion** can apply to an **Unpublished Artifact**
- **Deletion** of an **Unpublished Artifact** can trigger **Upload Cleanup**
- **Deletion** is not reversible as an access state
- **Deletion** can purge stored bytes asynchronously
- A **Workspace** has one **Workspace Member** in the MVP
- A **Workspace Member** has a **Personal Workspace** by default
- **Personal Workspace** is a human onboarding concept, not an agent-facing ownership type
- A **Workspace Member** has full authority in their **Workspace** in the MVP
- First sign-in for a new identity auto-provisions the **Personal Workspace**, the **Workspace Member** row, and a default **API Key** with full publishing **Scopes**; the **API Key** secret is shown once and never retrievable again
- A **Workspace** has zero or more **Audit Events**
- An **Audit Event** has exactly one **Change Summary**
- **Audit Retention** is separate from **Usage Policy**
- **Audit Events** are visible only to **Workspace Members** in the MVP
- **Unpublished Artifact** creation, **Publish**, **Deletion**, **Draft Revision** discard, **Retention** removals, **Display Metadata** changes, **Safety Warnings**, durable **Usage Policy** enforcement, **API Key** changes, **API Key Revocation**, **Access Link** changes, and **Access Link Lockdown** changes create **Audit Events**
- Routine **Upload Cleanup** does not create **Audit Events**
- **Upload Cleanup** creates **Audit Events** when it removes stale **Unpublished Artifact** management state
- A **Workspace** can have zero or more **API Keys**
- An **API Key** belongs to exactly one **Workspace**
- An **API Key** has one or more **Scopes**
- A **Workspace Member** holds every **Scope** implicitly when authenticated for direct workspace control (the dashboard)
- The CLI does not receive the implicit grant: `agent-paste login` mints an **API Key** capped at `publish` and `read`, so the CLI acts with that key's **Scope** subset, never **Member-Only Scopes** (ADR 0060)
- A future delegated agent surface (MCP) that carries scopes in its own token likewise gets an explicit subset, never **Member-Only Scopes**
- A **Workspace Member** holds **Member-Only Scopes** that no **API Key** can hold and that no delegated agent surface can carry
- **API Key** lifecycle management requires a **Member-Only Scope**
- **Audit Event** reads require a **Member-Only Scope**
- **Workspace** administration requires a **Member-Only Scope**
- An **API Key** is named by a **Workspace Member**
- An **API Key** has no **Expiration** unless one is set
- An **API Key** **Expiration** stops future use of the **API Key**
- An **API Key** **Expiration** does not revoke **Artifacts** or **Access Links** created with it
- **API Key Revocation** stops future use of the **API Key**
- **API Key Revocation** does not revoke **Artifacts** or **Access Links** created with it
- An **API Key** requires a read **Scope** to read private **Artifacts**
- An **API Key** requires a share **Scope** to manage **Access Links**
- An **API Key** requires read and share **Scopes** to create **Access Links**
- An **API Key** requires read and share **Scopes** to mint **Access Link Signed URLs**
- An **API Key** requires a share **Scope** to change **Access Link Lockdown**
- A share **Scope** does not imply a read **Scope**
- A write **Scope** does not imply a share **Scope**
- **Publish** requires write, read, and share **Scopes**
- **Upload Sessions** require a write **Scope**, not a share **Scope**
- A write-only **API Key** can prepare a **Draft Revision** for another actor to **Publish**
- A **Creator** is recorded for an **Artifact** but does not own it
- A **Creator** is recorded before first **Publish** when an **Unpublished Artifact** is created
- A **Creator** remains recorded after **API Key Revocation** or **API Key** **Expiration**
- A **Creator** does not change when another actor updates an **Artifact**
- An **API Key** secret follows the **API Key Bearer Format**
- The **API Key Bearer Format** `publicId` segment is stored plaintext and indexed for credential lookup
- An **API Key** secret is stored as HMAC-SHA-256 of the `secret` segment with a Worker-secret pepper; the plaintext `secret` is never persisted
- The **API Key Bearer Format** `env` segment matches the deployment environment; an **API Key** minted in one environment is not valid in another
- Logs and audit summaries redact the `secret` segment of any **API Key Bearer Format** value and may retain `ap_pk_{env}_{publicId}…` for correlation
- An **Access Link** is materialized as an **Access Link Signed URL** at mint time
- An **Access Link Signed URL** carries the signed payload in the URL fragment, never in the path or query
- An **Access Link Signed URL** payload is binary-packed `(version, kid, exp, scopes, sig)` then base64url-encoded
- An **Access Link Signed URL** signature is HMAC-SHA-256 over `(version, kid, exp, scopes, publicId)` using the **Access Link** signing key identified by `kid`
- The **Access Link** signing key rotates on the same 90-day cadence as other platform signing keys
- An **Access Link Signed URL** has a per-URL expiration distinct from the **Access Link** row's own expiration; re-minting produces a fresh per-URL expiration
- An **Access Link Signed URL** is resolved by `api`, not by `content`, so row-level lockdown and scopes are enforced inside the database
- An **Access Link Signed URL** that fails any of signature, expiration, scope, lockdown, or revocation checks returns the generic `not_found` envelope
- Resolve request logs, traces, analytics events, and audit summaries must not store the **Access Link Signed URL** fragment payload
- Re-minting an **Access Link Signed URL** does not change the underlying **Access Link** row, its expiration, or its **Audit Event** history
- An **Access Link** row holds no bearer secret, no ciphertext, and no wrapping key; the signature is the credential
- An **Access Link Signed URL** minted in one environment is not valid in another because the signing key is environment-scoped
- Any **API Key** with the right **Scope** in the owning **Workspace** can update an **Artifact**
- Any **API Key** with the right **Scope** in the owning **Workspace** can update **Display Metadata**
- Updating a known **Artifact** does not require a read **Scope**
- Updating **Display Metadata** for a known **Artifact** does not require a read **Scope**
- **Publish** always requires a read **Scope** because it creates a **Revision Link**
- An **Artifact** contains **Untrusted Content**
- An **Artifact** can have zero or more **Safety Warnings**
- A **Revision** can have zero or more **Safety Warnings**
- Artifact-level **Safety Warnings** summarize the latest **Published Revision**
- **Revision Links** show **Safety Warnings** for their pinned **Revision**
- **Safety Warnings** can be created during **Publish** or by asynchronous scanning
- **Safety Warnings** can be added, changed, or removed after a **Revision** is published without changing the **Revision**
- Asynchronous **Safety Warning** changes create **Audit Events**
- **Safety Warnings** do not block **Publish**
- A **Manifest** is platform-controlled data, not **Untrusted Content**
- **Display Metadata** is platform-controlled data, not **Untrusted Content**
- **Display Metadata** can change without creating a new **Revision**
- **Display Metadata** is plain text
- **Display Metadata** carries exactly two fields in the MVP: a required title and an optional description
- **Display Metadata** can contain Unicode but must be sanitized and escaped before display
- **Agent View** returns **Display Metadata** as plain text, not rendered HTML
- An **Agent View** includes the **Manifest**, file listing, content links, **Display Metadata**, **Safety Warnings**, and **Bundle Availability** for its resolved **Revision**
- An **Agent View** returned through an **Access Link** resolve omits the **Creator** reference on the **Manifest**; an authenticated **Agent View** returns it
- A **Manifest** does not carry the owning **Workspace** identifier on any surface
- **Safety Warnings** are exposed beside the **Manifest**, not inside it
- **Display Metadata** is exposed beside the **Manifest**, not inside it
- A **Manifest** resolves to the latest **Published Revision** through **Private Links** and **Share Links**
- A **Manifest** resolves to one pinned **Revision** through a **Revision Link**
- **Untrusted Content** is served from a **Content Origin**
- **Agent View**, **Manifest**, and **Display Metadata** are not served as **Untrusted Content**
- **Untrusted Content** is viewed under an **Execution Policy**
- **Execution Policy** applies to all **Render Modes**
- The MVP uses one fixed **Execution Policy** for all **Untrusted Content**, with one per-response tightening: SVG responses carry a stricter **Execution Policy** that blocks `<script>` execution
- A **Served Content Type** is derived by `content` from the normalized file extension, not from any value the agent supplied at upload
- A **Served Content Type** for `text/*` types includes `charset=utf-8`
- Unrecognized file extensions resolve to **Served Content Type** `application/octet-stream` with `Content-Disposition: attachment`
- SVG files resolve to **Served Content Type** `image/svg+xml` and carry the tightened SVG **Execution Policy**
- Renderer pages served by `content` declare their own **Served Content Type** and are not routed through the allowlist
- A **Served Content Type** is platform-controlled; **Workspace** settings and agent-provided values cannot change it
- **Publish** returns a **Publish Result**
- An **Artifact** is created and updated through `api`, never directly through `upload` or `content`
- `api` is the only Worker authorized to commit durable business writes to Postgres
- An **Upload Session** is created, finalized, and observed through `upload`
- A **Revision** file's bytes are written to R2 by `upload` and read from R2 by `content`
- A **Bundle**'s bytes are written to R2 by `jobs` and read from R2 by `content`
- `content` holds no Postgres binding; the **Workspace**, **Artifact**, and **Revision** identities it serves are derivable from the verified content-gateway token
- `content` reads the denylist; `api` and `jobs` write to it
- A **Workspace Member** controls a **Workspace** directly through `web` (dashboard) and through delegated agent surfaces `cli` and `mcp`
- An **API Key** authenticates against `api` and `upload`; it is never accepted by `mcp` or by operator-only `/admin/...` routes on `api`
- `web` reaches `api` over a **Service Binding**; `mcp` reaches `api` over a **Service Binding**
- `stream` reaches `api` over a **Service Binding** to authorize each **Live Update** viewer connection
- `api` notifies `stream` on **Publish** so it can fan out the new **Published Revision** to connected viewers
- `stream` holds no Postgres, R2, or KV binding; the **Published Revision** pointer it relays is platform-controlled data, not **Untrusted Content**
- A **Service Binding** call still carries the original bearer; the downstream Worker re-verifies it rather than trusting the upstream Worker
- `jobs` is the only Worker that consumes Cloudflare Queues; `api` and `upload` are queue producers
- The `cli` is not a Worker; it runs on a developer or agent machine and authenticates against `api` and `upload` over HTTPS

## Example dialogue

> **Dev:** "Can an **Artifact** contain both an HTML page and its supporting images?"
> **Domain expert:** "Yes — an **Artifact** is folder-like, so an agent can upload one file or a small set of related assets."
> **Dev:** "Does the agent always have to name the **Entrypoint**?"
> **Domain expert:** "No — infer it when obvious, but let the agent override it."
> **Dev:** "Does the agent always have to set **Render Mode**?"
> **Domain expert:** "No — infer it when obvious, but let the agent override it."
> **Dev:** "What if the requested **Render Mode** cannot open the **Entrypoint**?"
> **Domain expert:** "**Publish** fails because the requested view cannot be produced."
> **Dev:** "For directory **Render Mode**, what is the **Entrypoint**?"
> **Domain expert:** "Reserved for later — the current first-slice contract requires a file **Entrypoint**."
> **Dev:** "Can an old **Revision Link** use a newer **Entrypoint**?"
> **Domain expert:** "No — **Entrypoint** and **Render Mode** belong to the resolved **Revision**."
> **Dev:** "If a **Share Link** leaks, do we have to move the **Artifact**?"
> **Domain expert:** "No — revoke or rotate the **Share Link** without changing the **Private Link**."
> **Dev:** "If a **Revision Link** leaks, do we have to delete the **Revision**?"
> **Domain expert:** "No — revoke the **Revision Link** without deleting the **Revision**."
> **Dev:** "Who owns an **Artifact** created by an agent?"
> **Domain expert:** "The **Workspace** that owns the **API Key** used by the agent."
> **Dev:** "Is **Creator** recorded only after first **Publish**?"
> **Domain expert:** "No — **Creator** is recorded when the **Artifact** management record is created."
> **Dev:** "If the creating **API Key** expires or is revoked, does the **Creator** disappear?"
> **Domain expert:** "No — **Creator** is historical attribution, not current authority."
> **Dev:** "Does **Creator** change when another agent publishes a new **Revision**?"
> **Domain expert:** "No — later actors are recorded through **Audit Events**."
> **Dev:** "Can trusted **API Keys** upload trusted HTML?"
> **Domain expert:** "No — **Untrusted Content** remains untrusted even when uploaded with a valid **API Key**."
> **Dev:** "Can **Untrusted Content** include JavaScript?"
> **Domain expert:** "Yes — JavaScript is allowed but remains **Untrusted Content**."
> **Dev:** "When an **Artifact** is updated, should existing links change?"
> **Domain expert:** "No — **Private Links** and **Share Links** stay stable and show the latest **Published Revision**."
> **Dev:** "Can a **Private Link** be pinned to an older **Revision**?"
> **Domain expert:** "No — a **Private Link** always follows the latest **Published Revision**."
> **Dev:** "Can viewers see files while an update is still uploading?"
> **Domain expert:** "No — viewers only see a **Published Revision**, never a **Draft Revision**."
> **Dev:** "Can an **Artifact** exist before first **Publish**?"
> **Domain expert:** "Yes — an **Unpublished Artifact** can have management state, but no viewing links resolve."
> **Dev:** "Does creating an **Unpublished Artifact** create an **Audit Event**?"
> **Domain expert:** "Yes — it creates durable workspace management state."
> **Dev:** "Can **Workspace Members** see a **Draft Revision**?"
> **Domain expert:** "Yes — management surfaces can show drafts, but viewing links remain published-only."
> **Dev:** "Can a read-only **API Key** see **Draft Revisions**?"
> **Domain expert:** "No — draft access is a management capability tied to write **Scope**."
> **Dev:** "Can an agent discard a **Draft Revision**?"
> **Domain expert:** "Yes — an **API Key** with write **Scope** can discard it without affecting the **Published Revision**."
> **Dev:** "Does discarding a **Draft Revision** create an **Audit Event**?"
> **Domain expert:** "Yes — finalized draft state is durable management state."
> **Dev:** "Can only the original **Creator** update an **Artifact**?"
> **Domain expert:** "No — update permission comes from the **API Key Scope** within the owning **Workspace**."
> **Dev:** "Can an agent update **Display Metadata**?"
> **Domain expert:** "Yes — an **API Key** with the right **Scope** can update it."
> **Dev:** "How does another agent inspect an **Artifact** before opening files?"
> **Domain expert:** "It uses the **Agent View**, which includes the **Manifest**, file listing, and content links."
> **Dev:** "Is the **Manifest** just another uploaded file?"
> **Domain expert:** "No — the **Manifest** is platform-controlled data stored outside the **Untrusted Content**."
> **Dev:** "Does a **Revision Link** show the latest **Manifest**?"
> **Domain expert:** "No — it shows the **Manifest** for its pinned **Revision**."
> **Dev:** "Is a **Private Link** only a dashboard page?"
> **Domain expert:** "No — it is authenticated read access for human views and the **Agent View**."
> **Dev:** "Is a **Private Link** an **Access Link**?"
> **Domain expert:** "No — **Access Links** are unauthenticated grants, while **Private Links** require tenant authentication."
> **Dev:** "Are **Share Links** and **Revision Links** separate access mechanisms?"
> **Domain expert:** "No — both are **Access Links**; a **Share Link** follows the latest **Published Revision**, while a **Revision Link** pins one **Revision**."
> **Dev:** "If many **Access Links** leak, do we have to delete the **Artifact**?"
> **Domain expert:** "No — put the **Artifact** in **Access Link Lockdown** without affecting its **Private Link**."
> **Dev:** "Can **Access Link Lockdown** disable links for a whole **Workspace**?"
> **Domain expert:** "Not in the MVP — **Access Link Lockdown** applies to one **Artifact**."
> **Dev:** "When **Access Link Lockdown** is lifted, do revoked links work again?"
> **Domain expert:** "No — lifting **Access Link Lockdown** restores only otherwise-valid **Access Links**."
> **Dev:** "Can **Access Link Lockdown** expire automatically?"
> **Domain expert:** "Not in the MVP — it must be lifted explicitly."
> **Dev:** "Can authorized agents retrieve full **Access Link** URLs during **Access Link Lockdown**?"
> **Domain expert:** "No — they can see metadata and lockdown state, but cannot mint fresh **Access Link Signed URLs** until lockdown is lifted."
> **Dev:** "Can an agent revoke a specific **Access Link** during **Access Link Lockdown**?"
> **Domain expert:** "Yes — lockdown still allows cleanup of individual **Access Links**."
> **Dev:** "Can an agent change **Access Link** **Expiration** during **Access Link Lockdown**?"
> **Domain expert:** "Yes — expiration can change, but lockdown still prevents access."
> **Dev:** "Can an agent publish a new **Revision** while **Access Link Lockdown** is active?"
> **Domain expert:** "No — **Publish** requires a new **Revision Link**, and lockdown prevents new **Access Links**."
> **Dev:** "Can another agent use a **Share Link** without an **API Key**?"
> **Domain expert:** "Yes — a **Share Link** grants read-only access to the **Agent View** and published files."
> **Dev:** "Can another agent use a **Revision Link** to inspect an exact **Revision**?"
> **Domain expert:** "Yes — a **Revision Link** grants read-only access to the **Agent View** for that **Revision**."
> **Dev:** "Can **Untrusted Content** run on the app's own domain?"
> **Domain expert:** "No — **Untrusted Content** is viewed from a separate **Content Origin**."
> **Dev:** "Is the **Agent View** served as **Untrusted Content**?"
> **Domain expert:** "No — **Agent View**, **Manifest**, and **Display Metadata** are platform-controlled surfaces."
> **Dev:** "Is an update a patch over the previous **Revision**?"
> **Domain expert:** "No — each **Revision** is a complete immutable file tree."
> **Dev:** "Is an **Upload Session** the same as a **Draft Revision**?"
> **Domain expert:** "No — an **Upload Session** is the workflow for collecting files; the **Draft Revision** is the unpublished saved state."
> **Dev:** "Does finalizing an **Upload Session** update stable links?"
> **Domain expert:** "No — stable links change only when **Publish** makes a **Revision** the **Published Revision**."
> **Dev:** "Can two finished uploads wait to publish on the same **Artifact**?"
> **Domain expert:** "No — an **Artifact** can have many **Upload Sessions**, but only one finalized **Draft Revision**."
> **Dev:** "What happens if another upload finalizes while a **Draft Revision** already exists?"
> **Domain expert:** "Finalization fails until the existing **Draft Revision** is published or discarded."
> **Dev:** "Do **Access Links** expire by default?"
> **Domain expert:** "No — an **Access Link** remains valid until revoked unless an **Expiration** is set."
> **Dev:** "Should risky-looking uploads be blocked?"
> **Domain expert:** "Not initially — attach **Safety Warnings** without blocking the upload."
> **Dev:** "Can a **Safety Warning** reject a **Publish**?"
> **Domain expert:** "No — blocked publishes are validation or policy failures, not **Safety Warnings**."
> **Dev:** "Does an old **Revision Link** show warnings from the latest **Revision**?"
> **Domain expert:** "No — it shows **Safety Warnings** for its pinned **Revision**."
> **Dev:** "Can **Safety Warnings** appear after a **Revision** was already published?"
> **Domain expert:** "Yes — warnings can be added, changed, or removed after publication without changing the **Revision**."
> **Dev:** "Do asynchronous **Safety Warning** changes create **Audit Events**?"
> **Domain expert:** "Yes — they are visible security annotations."
> **Dev:** "Are **Safety Warnings** part of the **Manifest**?"
> **Domain expert:** "No — **Agent View** exposes **Safety Warnings** beside the **Manifest**."
> **Dev:** "If a title changes, does that create a new **Revision**?"
> **Domain expert:** "No — titles and labels are **Display Metadata**, exposed beside the **Manifest**."
> **Dev:** "Can **Display Metadata** contain Markdown?"
> **Domain expert:** "No — **Display Metadata** is plain text; agents can upload Markdown as **Untrusted Content**."
> **Dev:** "Does **Agent View** return rendered HTML for **Display Metadata**?"
> **Domain expert:** "No — it returns plain text values for consumers to escape in context."
> **Dev:** "Do **Display Metadata** changes create **Audit Events**?"
> **Domain expert:** "Yes — they change how humans and agents understand the **Artifact**."
> **Dev:** "Where do upload and retention limits live?"
> **Domain expert:** "They belong to the **Workspace** through its **Usage Policy**."
> **Dev:** "Can one **Artifact** have a custom **Usage Policy**?"
> **Domain expert:** "No — **Usage Policy** applies to the whole **Workspace**."
> **Dev:** "Can **Usage Policy** stop a new **Access Link** from being created?"
> **Domain expert:** "Yes — **Access Link** creation is controlled by the **Workspace** **Usage Policy**."
> **Dev:** "Is workspace policy blocking new **Access Links** the same as **Access Link Lockdown**?"
> **Domain expert:** "No — **Usage Policy** controls future creation across a **Workspace**, while **Access Link Lockdown** disables one **Artifact**'s existing links."
> **Dev:** "If **Usage Policy** disables new **Access Links**, do old links stop working?"
> **Domain expert:** "No — existing **Access Links** keep working unless a separate durable enforcement action changes them."
> **Dev:** "Do **Unpublished Artifacts** count against creation limits?"
> **Domain expert:** "Yes — **Usage Policy** controls their creation too."
> **Dev:** "What is the simplest way for an agent to share a folder?"
> **Domain expert:** "It should call **Publish** and receive usable links."
> **Dev:** "What does an agent get back after **Publish**?"
> **Domain expert:** "A **Publish Result** with IDs, **Private Link**, **Revision Link**, agent-view links, **Bundle** status, and any **Safety Warnings**."
> **Dev:** "Does **Publish** make an **Artifact** shareable by default?"
> **Domain expert:** "No — **Publish** creates a **Share Link** only when sharing is requested."
> **Dev:** "What if a requested **Share Link** cannot be created during **Publish**?"
> **Domain expert:** "**Publish** fails before the **Revision** becomes visible."
> **Dev:** "Can a **Share Link** be pinned to the current **Published Revision**?"
> **Domain expert:** "No — **Share Links** always follow the latest **Published Revision**; use a **Revision Link** to pin one."
> **Dev:** "Can an agent create a **Share Link** after **Publish**?"
> **Domain expert:** "Yes — **Share Links** can be created during **Publish** or later."
> **Dev:** "Can an agent create a **Share Link** while **Access Link Lockdown** is active?"
> **Domain expert:** "No — lockdown prevents creating new **Access Links**."
> **Dev:** "Does **Publish** create a pinned link for the exact **Revision**?"
> **Domain expert:** "Yes — each published **Revision** receives a revocable **Revision Link**."
> **Dev:** "Can an agent create another **Revision Link** for the same **Revision**?"
> **Domain expert:** "Yes — additional **Revision Links** can be created for separate audiences."
> **Dev:** "Can an agent create an additional **Revision Link** during **Access Link Lockdown**?"
> **Domain expert:** "No — lockdown prevents creating new **Access Links**."
> **Dev:** "Can an agent create a **Revision Link** for a removed or draft **Revision**?"
> **Domain expert:** "No — **Revision Links** can target only retained published **Revisions**."
> **Dev:** "What if **Usage Policy** blocks the required **Revision Link**?"
> **Domain expert:** "Then **Publish** fails before the **Revision** becomes visible."
> **Dev:** "Can an agent get a **Revision Link** for a **Draft Revision**?"
> **Domain expert:** "No — **Revision Links** are created only when a **Revision** is published."
> **Dev:** "Does an old **Revision Link** break when a newer **Revision** is published?"
> **Domain expert:** "No — it keeps pointing at the older **Revision** unless revoked, expired, deleted, or removed by **Retention**."
> **Dev:** "When **Retention** removes an old **Revision**, is its **Revision Link** considered revoked?"
> **Domain expert:** "No — revocation and **Retention** are different reasons access can stop."
> **Dev:** "Does **Retention** purge stored bytes immediately?"
> **Domain expert:** "No — **Retention** makes **Revisions** unavailable first, then bytes can be purged asynchronously."
> **Dev:** "Do **Retention** removals create **Audit Events**?"
> **Domain expert:** "Yes — they change visible revision history and access."
> **Dev:** "Can private access be granted for one **Artifact** but not another?"
> **Domain expert:** "No — private access is based on **Workspace Member** access, not per-**Artifact** permissions."
> **Dev:** "How does an agent receive access?"
> **Domain expert:** "A **Workspace Member** creates a named, scoped **API Key** and gives the secret to the agent."
> **Dev:** "Does an agent need to know whether a **Workspace** is personal?"
> **Domain expert:** "No — agents only need the owning **Workspace**."
> **Dev:** "Does expiring an **API Key** remove what it created?"
> **Domain expert:** "No — **Expiration** stops future key use, but created **Artifacts** and **Access Links** remain."
> **Dev:** "Does **API Key Revocation** remove what the key created?"
> **Domain expert:** "No — it stops future key use, but created **Artifacts** and **Access Links** remain."
> **Dev:** "Do **Scopes** limit **Workspace Members**?"
> **Domain expert:** "No — through the dashboard a **Workspace Member** holds every **Scope** implicitly, including **Member-Only Scopes** that an **API Key** cannot hold. Through the CLI the same person acts with a minted **API Key** capped at `publish` and `read`; a future MCP surface would carry an explicit token **Scope** subset. Neither path ever includes **Member-Only Scopes**."
> **Dev:** "Does **API Key Revocation** create an **Audit Event**?"
> **Domain expert:** "Yes — credential lifecycle changes are security-relevant."
> **Dev:** "Can a publishing **API Key** read private **Artifacts**?"
> **Domain expert:** "Only if it has a read **Scope**."
> **Dev:** "Can any write-capable **API Key** manage **Access Links**?"
> **Domain expert:** "No — managing **Access Links** requires a share **Scope**."
> **Dev:** "Can a share-only **API Key** create **Access Links**?"
> **Domain expert:** "No — minting **Access Link Signed URLs** requires both read and share **Scopes**."
> **Dev:** "Can a share-only **API Key** mint **Access Link Signed URLs**?"
> **Domain expert:** "No — minting **Access Link Signed URLs** requires both read and share **Scopes**."
> **Dev:** "Does share **Scope** include read **Scope**?"
> **Domain expert:** "No — **Scopes** are independent."
> **Dev:** "Does write **Scope** include share **Scope**?"
> **Domain expert:** "No — **Publish** requires write, read, and share because they are separate powers."
> **Dev:** "Can an **API Key** publish with write **Scope** but no read or share **Scope**?"
> **Domain expert:** "No — **Publish** creates a **Revision Link**, so it requires write, read, and share **Scopes**."
> **Dev:** "Does creating an **Upload Session** require a share **Scope**?"
> **Domain expert:** "No — **Upload Sessions** create drafts, so write **Scope** is enough."
> **Dev:** "Can one agent upload a draft and another publish it?"
> **Domain expert:** "Yes — a write-only **API Key** can prepare a **Draft Revision** for another actor to **Publish**."
> **Dev:** "Can an **Upload Session** expire?"
> **Domain expert:** "Yes — after **Expiration**, it can no longer be used."
> **Dev:** "Does **Retention** clean up expired **Upload Sessions**?"
> **Domain expert:** "No — **Upload Cleanup** removes stale **Unpublished Artifacts** and unpublished bytes left by upload workflows."
> **Dev:** "Can **Usage Policy** keep abandoned upload bytes longer?"
> **Domain expert:** "No — **Upload Cleanup** is platform-controlled operational hygiene."
> **Dev:** "Does routine **Upload Cleanup** create **Audit Events**?"
> **Domain expert:** "No — routine byte cleanup is operational unless product-visible state changes."
> **Dev:** "What if **Upload Cleanup** removes a stale **Unpublished Artifact**?"
> **Domain expert:** "That creates an **Audit Event** because management state changed."
> **Dev:** "Can an **API Key** update a known **Artifact** without reading it first?"
> **Domain expert:** "Yes — update authority comes from the write **Scope**, not the read **Scope**."
> **Dev:** "Can an **API Key** publish without read **Scope**?"
> **Domain expert:** "No — **Publish** creates a **Revision Link** as an **Access Link Signed URL**, so read **Scope** is required."
> **Dev:** "Does updating **Display Metadata** require a read **Scope**?"
> **Domain expert:** "No — write **Scope** is enough for a known **Artifact**."
> **Dev:** "Can uploaded JavaScript call arbitrary external APIs?"
> **Domain expert:** "Not by default — the **Execution Policy** restricts external network access."
> **Dev:** "Does **Execution Policy** only apply to HTML?"
> **Domain expert:** "No — it applies to all **Render Modes** for **Untrusted Content**."
> **Dev:** "Can an agent request a custom **Execution Policy**?"
> **Domain expert:** "Not in the MVP — all **Untrusted Content** uses one fixed **Execution Policy**."
> **Dev:** "Can **Render Mode** be audio?"
> **Domain expert:** "Yes — audio is a first-class **Render Mode**."
> **Dev:** "Can **Render Mode** be video?"
> **Domain expert:** "Yes — video is a first-class **Render Mode** controlled by **Usage Policy**."
> **Dev:** "Can a viewer download the whole **Artifact**?"
> **Domain expert:** "Yes — each **Revision** can be retrieved as a **Bundle**."
> **Dev:** "Is a **Bundle** guaranteed for every **Revision**?"
> **Domain expert:** "No — **Usage Policy** controls whether a **Bundle** is available."
> **Dev:** "Does **Publish** wait until the **Bundle** is ready?"
> **Domain expert:** "No — the **Bundle** can become available after **Publish** completes."
> **Dev:** "How long do old **Revisions** remain available?"
> **Domain expert:** "By default, **Retention** keeps all **Revisions** unless a **Usage Policy** removes them."
> **Dev:** "Can a **Workspace Member** delete just one old **Revision**?"
> **Domain expert:** "Not in the MVP — **Deletion** applies to the whole **Artifact**, while **Retention** removes individual **Revisions**."
> **Dev:** "Can **Retention** remove the **Published Revision**?"
> **Domain expert:** "No — the **Published Revision** remains until a newer **Revision** is published or the **Artifact** is deleted."
> **Dev:** "What happens when an **Artifact** is deleted?"
> **Domain expert:** "**Deletion** makes all links stop resolving immediately, then stored bytes can be purged asynchronously."
> **Dev:** "Can an **Unpublished Artifact** be deleted?"
> **Domain expert:** "Yes — **Deletion** removes its management state and any draft workflow."
> **Dev:** "What happens to uploaded bytes for a deleted **Unpublished Artifact**?"
> **Domain expert:** "**Upload Cleanup** removes draft or upload-session bytes."
> **Dev:** "Can **Deletion** be undone like **Access Link Lockdown**?"
> **Domain expert:** "No — **Deletion** is the hard access boundary, not a reversible sharing control."
> **Dev:** "How do we know who changed access or content?"
> **Domain expert:** "Security-relevant and lifecycle changes create **Audit Events** in the **Workspace**."
> **Dev:** "Does **Usage Policy** control how long **Audit Events** are kept?"
> **Domain expert:** "No — **Audit Retention** is platform-controlled separately."
> **Dev:** "Can an **API Key** with read **Scope** read **Audit Events**?"
> **Domain expert:** "No — **Audit Event** reads require a **Member-Only Scope**, which only a dashboard-authenticated **Workspace Member** carries. An **API Key** cannot hold it; CLI and MCP tokens cannot carry it."
> **Dev:** "Do **Access Link** changes create **Audit Events**?"
> **Domain expert:** "Yes — they are unauthenticated access grants, so lifecycle changes are security-relevant."
> **Dev:** "Do **Audit Events** store raw uploaded content or secrets?"
> **Domain expert:** "No — they store redacted **Change Summaries**."
> **Dev:** "Does **Publish** wait for deep content scanning?"
> **Domain expert:** "No — cheap **Safety Warnings** can be returned during **Publish**, and deeper warnings can be added asynchronously."

## Flagged ambiguities

- "artifact" was initially ambiguous between a single file and a package — resolved: an **Artifact** is folder-like and may contain multiple files or assets.
- "upload session" was used in ADRs without a glossary definition — resolved: an **Upload Session** is the temporary workflow used to collect files for a future **Revision**, not the **Draft Revision** itself.
- "publish" and upload finalization sounded interchangeable in ADR language — resolved: finalization creates a **Draft Revision**, while **Publish** makes a **Revision** visible as the **Published Revision**.
- "zero or more upload sessions" conflicted with "zero or one draft revision" until finalization was clarified — resolved: many **Upload Sessions** may exist, but only one finalized **Draft Revision** can wait to publish on an **Artifact**.
- "revoked" was ambiguous between deliberate access removal and lifecycle removal — resolved: **Revision Link** revocation is distinct from **Retention** making its target unavailable.
- "share link" and "revision link" duplicated unauthenticated access rules — resolved: both are **Access Links** with different target behavior.
- "private link" sounded like another access-link type — resolved: **Private Link** is authenticated tenant access, while **Access Links** are unauthenticated grants.
- "deletion" and reversible access controls were easy to blur — resolved: **Deletion** is not reversible as an access state.
- "workspace member" may become multi-member later — resolved: a **Workspace** has one **Workspace Member** in the MVP, while the **Workspace** boundary remains future-compatible.
- "retention" and upload cleanup were easy to conflate — resolved: **Retention** governs published history, while **Upload Cleanup** removes unpublished upload-session bytes.
- "retention" was further ambiguous between per-**Revision** pruning and whole-**Artifact** lifecycle — resolved: **Retention** governs older non-published **Revisions** within an **Artifact**, while **Auto Deletion** triggers **Deletion** on the whole **Artifact** after a configured age.
