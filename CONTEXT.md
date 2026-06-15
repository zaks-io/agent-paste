# Agent Artifact Sharing

A platform for agents to publish shareable work products that can be viewed online by humans or consumed by other agents.

For repository orientation, app/package ownership, and common lookup paths, use
[`docs/agents/repo-navigation.md`](./docs/agents/repo-navigation.md).

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
A saved state of an **Artifact** after creation or update. A **Revision** has zero or one parent **Revision** (a commit chain within the **Artifact**); a **Revision** published against a parent may inherit unchanged files from it instead of re-uploading them.
_Avoid_: Version, snapshot

<a id="draft-revision"></a>
**Draft Revision**:
A **Revision** that has been uploaded but is not yet visible through stable **Artifact** links.
_Avoid_: Partial update, pending files

<a id="published-revision"></a>
**Published Revision**:
The **Revision** currently visible through stable **Artifact** links.
_Avoid_: Live version, current snapshot

<a id="artifact-console"></a><a id="artifact-url"></a>
**Artifact Console**:
The dashboard-only management page for an **Artifact** (`/artifacts/<id>`): access-links table, lockdown, revisions. Never returned by **Publish** or any agent surface.
_Avoid_: Artifact URL, Private Link, Access Link, public link, Revision Content URL, live handoff URL

<a id="artifact-viewer"></a>
**Artifact Viewer**:
The recipient-facing browser surface that displays a **Published Revision** without dashboard management chrome. It is opened by a **Private Link** (the authenticated `/v/<artifactId>` clean viewer for a **Workspace Member**) or by an **Access Link Signed URL** (the unauthenticated recipient path).
_Avoid_: Artifact Console, dashboard artifact page, app page

<a id="live-update"></a>
**Live Update**:
The behavior by which an already-open app-origin live viewer receives a platform-controlled **Publish Update** or **State Update** without a manual reload.
_Avoid_: Live edit, real-time sync, hot reload, watch mode

<a id="publish-update"></a>
**Publish Update**:
A **Live Update** that advances an already-open live viewer to the latest **Published Revision** after **Publish**.
_Avoid_: Revision update, live revision, hot reload

<a id="state-update"></a>
**State Update**:
A **Live Update** that delivers a committed **Artifact State** change to an already-open live viewer.
_Avoid_: State sync, storage event, realtime database update

<a id="upload-session"></a>
**Upload Session**:
A temporary workflow for collecting files that will become a complete **Revision** when finalized.
_Avoid_: Upload batch, direct upload, pending upload

<a id="revision-link"></a>
**Revision Link**:
An **Access Link** that resolves to one specific **Revision** of an **Artifact**. It is stable for that retained **Revision** and never receives a **Live Update**.
_Avoid_: Historical share link, frozen artifact link

<a id="revision-content-url"></a>
**Revision Content URL**:
A direct signed **Content Origin** URL shaped `https://usercontent.agent-paste.sh/v/{token}/{path}` for one file path in one **Revision**. Publish surfaces return it as `revision_content_url`. It expires with its signed token and never receives a **Live Update**.
_Avoid_: Share link, Artifact URL, permalink, live link

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

<a id="ephemeral-workspace"></a>
**Ephemeral Workspace**:
A system-owned, unclaimed **Workspace** that an agent self-provisions with no **Workspace Member**, behind a short-lived, low-cap **Agent Credential**. It is an ordinary RLS-scoped tenant in its unclaimed state; promoted to a claimed **Workspace** by redeeming its **Claim Token**. Its content is served under a script-disabled **Execution Policy** while unclaimed; after claim, interactive HTML can execute only through the controlled **Artifact Viewer**.
_Avoid_: Anonymous account, agent account, guest workspace

<a id="ephemeral-publish"></a>
**Ephemeral Publish**:
A **Publish** performed against an **Ephemeral Workspace** with no human in the loop, gated by proof-of-work and the lowest trust-tier caps.
_Avoid_: Anonymous publish, guest publish

<a id="claim-token"></a>
**Claim Token**:
A one-time secret returned only to the caller that provisioned an **Ephemeral Workspace**, redeemed by an authenticated **Workspace Member** to take ownership of that tenant. Never embedded in an **Access Link Signed URL**.
_Avoid_: Upgrade code, ownership token

<a id="workspace-member"></a>
**Workspace Member**:
A human user with authenticated access to a **Workspace**.
_Avoid_: Teammate, collaborator

<a id="artifact-user"></a>
**Artifact User**:
A person or browser-scoped identity interacting with an **Artifact** through a minimal, artifact-scoped identity exposed to that **Artifact**.
_Avoid_: Viewer, WorkOS user, Workspace Member, participant

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
The limits a **Workspace** applies to artifact creation, retention, auto deletion, access-link creation, **File Size Cap**, **File Count Cap**, **Revision Size Cap**, **Bundle Size Cap**, **State Key Cap**, **State Value Size Cap**, **State Total Size Cap**, **State Write Rate Cap**, **Actor Rate Limit**, and **Workspace Burst Cap**.
_Avoid_: Quota settings, billing limits

<a id="plan"></a>
**Plan**:
The tier (`free` or `pro`) a **Workspace** is on. A **Plan** selects both the platform-defined **Usage Policy** values that apply within the platform hard ceilings and the set of platform features available to the **Workspace**; some features (such as **Live Update**) are available only on a higher **Plan**.
_Avoid_: Subscription, billing tier, account level, entitlement

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

<a id="state-key-cap"></a>
**State Key Cap**:
The cap on the number of **Artifact State** keys an **Artifact** can hold.
_Avoid_: Storage key quota, row limit

<a id="state-value-size-cap"></a>
**State Value Size Cap**:
The cap on bytes stored in one **Artifact State** value.
_Avoid_: Value quota, JSON size limit

<a id="state-total-size-cap"></a>
**State Total Size Cap**:
The cap on total **Artifact State** bytes an **Artifact** can hold.
_Avoid_: Storage quota, database limit

<a id="state-write-rate-cap"></a>
**State Write Rate Cap**:
The cap on **Artifact State** writes for an **Artifact**.
_Avoid_: Update quota, realtime limit

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
The cap on authenticated request rate per individual actor — one **Agent Credential** or one **Workspace Member** — against `api` and `upload`. Platform-controlled in the MVP and surfaced through **Usage Policy**.
_Avoid_: API rate limit, credential throttle

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

<a id="api-key"></a><a id="agent-credential"></a>
**Agent Credential**:
A credential that lets an agent create and manage **Artifacts** on behalf of a **Workspace**.
_Avoid_: User token, agent token

<a id="api-key-revocation"></a><a id="agent-credential-revocation"></a>
**Agent Credential Revocation**:
The action that stops future use of an **Agent Credential** without removing what it already created.
_Avoid_: Delete credential, revoke agent content

<a id="api-key-bearer-format"></a><a id="agent-credential-bearer-format"></a>
**Agent Credential Bearer Format**:
The string shape used for **Agent Credential** secrets: `ap_pk_{env}_{publicId}_{secret}`. `pk` is the credential-class marker, `env` matches the deployment environment, `publicId` is the indexed lookup segment stored plaintext, and `secret` is the high-entropy random segment hashed with a Worker-secret pepper for storage. **Access Link** tokens used to share this shape (with `type='al'`) but were moved to the **Access Link Signed URL** model and no longer follow this format.
_Avoid_: Token format, credential shape, credential prefix, bearer credential format

<a id="access-link-signed-url"></a>
**Access Link Signed URL**:
The shareable URL form of an **Access Link**, shaped `https://app.agent-paste.sh/al/{publicId}#{blob}` where `blob` is a base64url-encoded binary payload containing the signing-key generation, expiration, allowed scopes, and HMAC signature. The payload is carried in the URL fragment so it never reaches any server-side log, and the signature is the credential — the `access_links` row holds no secret material. An authorized **Workspace Member** or **Agent Credential** with read and publish **Scopes** mints a fresh URL on demand; re-minting produces a new URL with a new expiration.
_Avoid_: link token, access link secret, credential

<a id="creator"></a>
**Creator**:
The **Agent Credential** or workspace member that first created an **Artifact** management record.
_Avoid_: Owner, author

<a id="scope"></a>
**Scope**:
A named permission that authorizes an actor to perform a class of action within a **Workspace**. There is exactly one **Scope** vocabulary, shared verbatim by the API and the MCP surface (no per-surface names, no translation layer to keep in sync). The three **Scopes** are:

- `read` — view your own **Artifacts**, **Revisions**, and **Access Links**.
- `publish` — change your own content: create, revise, and delete **Artifacts**, and manage unauthenticated access to your own **Artifact** (share, list, and revoke its **Access Links**; in the planned **Public Artifact** model, select or clear its **Public Version**). This is the full agent write surface.
- `admin` — a **Member-Only Scope** for account/workspace management only (**Agent Credential** lifecycle, **Workspace** settings, **Audit Event** reads, billing). It does **not** grant content or unauthenticated access actions.

A **Workspace Member** authenticated for direct workspace control (the dashboard) is implicitly granted every **Scope**, including `admin`. An **Agent Credential** (created by `agent-paste login`) and an MCP member's delegated set are capped at `publish` and `read` (never `admin`), so every agent surface is structurally below the dashboard ceiling. A member's MCP **Scopes** are their stored API **Scopes** verbatim, derived in `api`, never carried in the OAuth token (ADR 0079).
_Avoid_: Role, capability, write/share (old MCP-only names — unified into `publish`)

<a id="member-only-scope"></a>
**Member-Only Scope**:
A **Scope** that only a **Workspace Member** can hold via direct workspace authentication (the dashboard); it cannot be granted to an **Agent Credential** and cannot be carried by tokens issued for delegated agent surfaces such as the CLI or MCP. The only **Member-Only Scope** is `admin`: it authorizes **Agent Credential** lifecycle management, **Audit Event** reads, **Workspace** settings, and billing. It is distinct from `publish`, which covers content changes and unauthenticated sharing actions on your own **Artifacts** and is available to agents.
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

<a id="artifact-state"></a>
**Artifact State**:
Small, mutable, platform-stored state attached to one **Artifact** and exposed only through the app-origin live viewer.
_Avoid_: Remote localStorage, app database, permanent storage

<a id="private-link"></a>
**Private Link**:
The login-walled clean viewer (`/v/<artifactId>`) for a **Workspace Member**, returned by every **Publish** as `private_url`. No management chrome. It is **permanent and stable**: the URL is built only from the **Artifact** id with no token, signature, or **Expiration** baked in, and `add_revision` republishes into the same id, so the same link keeps working and live-updates to the latest **Published Revision** — it never changes when content is revised. It is **member-only and always private**: there is no public mode and **Publish** never grants unauthenticated access. It stops resolving only when the **Artifact** itself is gone (deleted or swept by **Auto Deletion**), which is a property of the **Artifact**'s lifetime, not the link. To hand the same content to someone without a login, the **Member** mints a separate, revocable **Share Link**.
_Avoid_: Artifact URL, console link, /artifacts page, dashboard link, permalink (it is stable, but say "permanent member link" not "permalink", which we reserve against for public links)

<a id="access-link"></a>
**Access Link**:
A revocable, unlisted, high-entropy grant for reading an **Artifact** without tenant authentication. **Share Links** and **Revision Links** are Access Link types. An Access Link is the durable grant; an **Access Link Signed URL** is the URL string minted from that grant.
_Avoid_: Public Link, Artifact URL, content URL, dashboard URL

<a id="access-link-lockdown"></a>
**Access Link Lockdown**:
A state that makes all **Access Links** for an **Artifact** stop granting access without affecting its **Private Link**.
_Avoid_: Disable sharing, private mode, emergency revoke

<a id="platform-lockdown"></a>
**Platform Lockdown**:
A platform-initiated state that blocks all platform-controlled link resolution, public resolution, and public asset access for either a single **Artifact** or an entire **Workspace**, applied by the operator to respond to abuse reports, takedown requests, or external safety flags. It is the hard public takedown path for **Public Artifacts**: unlike **Public Offline**, it blocks the **Public Resolver** and **Public Version Assets** and uses cache purge or deny controls where available. A **Workspace**-scoped **Platform Lockdown** also suspends every **Agent Credential** in the **Workspace**.
_Avoid_: Suspension, ban, freeze, admin lock

<a id="share-link"></a>
**Share Link**:
A type of **Access Link** that resolves to the latest **Published Revision** of an **Artifact**. It opens the **Artifact Viewer** and can receive **Publish Updates**. It is the unlisted counterpart to the **Private Link**: a no-login URL, **off by default**, created only by an explicit sharing step, which mints or reuses the **one** Share Link an **Artifact** has and returns its **Access Link Signed URL**. **Publish** never creates one. It is the control-oriented unauthenticated path: it does not create a **Public URL** or **Public Version Assets** and is not the aggressive edge-cache surface. It is **revocable at any time** (`revoke_access_link`) and may expire, so avoid calling it public or a permalink; revoking it kills unlisted access without touching the **Artifact**, its data, its **Revisions**, or its **Private Link**.
_Avoid_: Public Link, Artifact Console, public app link, permalink, Revision Content URL

<a id="public-artifact"></a>
**Public Artifact**:
An **Artifact** intentionally configured for broad unauthenticated viewing through a **Public URL**, not merely shared through a high-entropy **Access Link Signed URL**. This is planned domain language from ADR 0087, not the shipped Share Link behavior described by ADR 0086. It is the distribution-oriented unauthenticated path: the first public action atomically allocates its **Public ID** and selects its initial **Public Version**. When online, it resolves through a selected **Public Version** and its **Public Version Assets** are designed for broad edge caching. When **Public Offline**, the permalink is retained but broad public viewing is unavailable.
_Avoid_: Share Link, Access Link, Unlisted Link, secret link

<a id="public-version"></a>
**Public Version**:
The **Published Revision** currently selected for broad unauthenticated viewing of a **Public Artifact**.
_Avoid_: Latest Revision, Live Version, public pointer

<a id="public-offline"></a>
**Public Offline**:
The reversible soft-control state where a **Public Artifact** keeps its **Public URL** and **Public ID** but has no selected **Public Version**, so broad unauthenticated public resolution is temporarily unavailable. Selecting a **Public Version** brings it back online without changing the permalink. It is not a hard takedown guarantee for already-cached **Public Version Assets**.
_Avoid_: Delete, revoke, Access Link Lockdown, Platform Lockdown, rotate Public ID

<a id="public-url"></a>
**Public URL**:
The stable browser URL for broad unauthenticated viewing of a **Public Artifact**, shaped `/p/{publicId}`. It remains reserved while the **Public Artifact** is **Public Offline** and resolves through the **Public Resolver**.
_Avoid_: Public Link, Share Link, Access Link Signed URL, Revision Content URL

<a id="public-id"></a>
**Public ID**:
The high-entropy identifier carried by a **Public URL**, distinct from the **Artifact** id.
_Avoid_: Artifact id, slug, title, human-readable name

<a id="public-resolver"></a>
**Public Resolver**:
The small mutable resolution layer behind a **Public URL**. It maps a **Public ID** to either the selected **Public Version** or **Public Offline** and must change quickly when the public pointer changes. It is not the long-lived cache boundary for **Untrusted Content**.
_Avoid_: CDN asset, static page, public file, Public Version Asset

<a id="public-version-asset"></a>
**Public Version Asset**:
An immutable **Untrusted Content** response for one file path in the **Published Revision** selected by a **Public Version**. It can be cached aggressively because selecting a different **Public Version** or going **Public Offline** changes the **Public Resolver** instead of mutating the asset.
_Avoid_: live asset, latest asset, mutable public file

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
The Worker that owns the per-**Artifact** **Live Update** channel. It holds a Durable Object that fans out **Publish Updates** and **State Updates** to connected **Private Link** and **Share Link** viewers over a held streaming connection, and it authorizes each connection by forwarding the viewer's **Access Link** credential or **Workspace Member** session to `api` over a **Service Binding**. Holds no Postgres, no R2, and no KV; carries no secrets and serves no **Untrusted Content**. `api` notifies it after **Publish** and committed **Artifact State** mutations.
_Avoid_: sse worker, push worker, realtime gateway

<a id="cli"></a>
**cli**:
The local `agent-paste` command-line tool. Not a Worker; runs on the developer or agent machine and talks to `api` and `upload` over HTTPS. `agent-paste login` runs a WorkOS loopback PKCE flow and stores a scoped local credential in the OS keyring when available, then discards the WorkOS token. Agents should check `agent-paste whoami`, run `agent-paste login` when interactive auth is possible, and publish with `agent-paste publish <path>`; hosted agents that cannot run the CLI should use MCP.
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

<a id="run-scope"></a>
**Run Scope**:
The tenant boundary one unit-of-work runs under: either a single **Workspace** (`{ kind: "workspace", workspaceId }`) or the whole platform (`{ kind: "platform" }`). It is the backend-agnostic equivalent of the database role a transaction runs as — the Postgres adapter translates it into `SET LOCAL app.workspace_id` RLS config; the local adapter translates it into a **Scoped View**. Workflows that legitimately cross tenants (credential discovery by public id, the claim-flow reparent) declare the platform **Run Scope** explicitly; everything else declares the workspace **Run Scope**.
_Avoid_: tenant context, RLS scope, query scope

<a id="scoped-view"></a>
**Scoped View**:
The local repository backend's enforcement of a **Run Scope**: a view over in-memory state that exposes only rows belonging to the run's **Workspace** (or all rows under the platform **Run Scope**). It is the local analogue of Postgres RLS. A foreign **read** returns nothing (RLS-faithful); a foreign **insert** (the one path that writes a full row through `set()`) throws, so a cross-tenant insert surfaces loudly as a failing test; every other foreign mutation is get-then-mutate, so the invisible row makes it a silent no-op. This deliberately makes the local backend a bug detector, not a faithful RLS emulator ([ADR 0083](./docs/adr/0083-local-repository-backend-enforces-run-scope.md)).
_Avoid_: tenant filter, RLS shim, scoped map

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
- **Draft Revisions** are visible to **Agent Credentials** with publish **Scope**
- A read **Scope** does not grant access to **Draft Revisions**
- **Agent Credentials** with publish **Scope** can discard **Draft Revisions**
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
- An **Artifact** has one live viewer experience whether reached through a **Private Link** or a **Share Link**
- **Revisions** are the saved history of an **Artifact**, not separate live viewer instances
- A **Private Link** resolves to the latest **Published Revision** of an **Artifact**
- A **Private Link** cannot be pinned to an older **Revision**
- A **Private Link** grants authenticated read access to human views and the **Agent View**
- A **Private Link** is not an **Access Link**
- A **Live Update** is either a **Publish Update** or a **State Update**
- A **Publish Update** advances an open viewer reached through an authenticated **Private Link** or a **Share Link** to the latest **Published Revision** without a manual reload
- A **Publish Update** occurs only when a new **Revision** is **Published** and never reveals a **Draft Revision**
- A **State Update** delivers **Artifact State** changes without creating or revealing a **Revision**
- A **Revision Link** never receives a **Publish Update** because it is pinned to one **Revision**
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
- A **Platform Lockdown** is operator-initiated and cannot be set or lifted by a **Workspace Member** or an **Agent Credential**
- A **Platform Lockdown** has scope `Artifact` or `Workspace`
- A **Platform Lockdown** at `Artifact` scope blocks the **Private Link**, every **Access Link**, the **Public Resolver**, and **Public Version Assets** for one **Artifact**
- A **Platform Lockdown** at `Workspace` scope blocks **Private Link**, **Access Link**, **Public Resolver**, and **Public Version Asset** access for every **Artifact** in the **Workspace**
- A **Platform Lockdown** at `Workspace` scope suspends every **Agent Credential** in the **Workspace**
- A **Platform Lockdown** is reversible by the operator
- A **Platform Lockdown** does not delete bytes or **Revisions**
- A **Platform Lockdown** uses cache purge and deny controls for **Public Version Assets** where available
- A **Platform Lockdown** does not auto-expire in the MVP
- A **Platform Lockdown** creates an **Audit Event** visible to **Workspace Members**
- A **Platform Lockdown** is not exposed through the public API, SDK, or CLI
- A **Platform Lockdown** is distinct from **Access Link Lockdown**: it is operator-initiated, also blocks the **Private Link**, **Public Resolver**, and **Public Version Assets**, and at `Workspace` scope suspends **Agent Credentials**
- An **Operator** is a **Workspace Member** whose authenticated email is on the platform operator allowlist
- An **Operator** acts with platform-wide authority only on operator-only routes; on every other route the identity is a normal **Workspace Member**
- An **Operator** identity cannot be assumed by an **Agent Credential**: operator-only routes reject **Agent Credential** authentication
- An **Operator** identity is reachable only through the web admin surface; the CLI exposes no operator-only commands
- An **Operator** action on operator-only routes is the `actor.type = 'platform'` actor in the **Audit Event**
- A **Platform Lockdown** can only be set or lifted by an **Operator**
- A **Share Link** resolves to the latest **Published Revision** of an **Artifact**
- A **Share Link** is an **Access Link** type, not a synonym for **Access Link**
- The signed URL minted from a **Share Link** is an unlisted, no-login handoff produced by an explicit sharing step
- A **Revision Link** resolves to exactly one **Revision**
- A **Revision Link** can continue resolving to an older **Revision** after a newer **Revision** is published
- A **Revision Link** can be revoked without deleting its **Revision**
- **Retention** can make a **Revision Link** stop resolving without revoking it
- The base REST/CLI **Publish Result** includes the **Artifact** id, **Revision** id, authenticated **Private Link** (`private_url`), direct signed **Revision Content URL**, public **Agent View** URL, expiration, and **Bundle Availability**
- **Publish** is content-only and private-first on every surface (CLI, MCP, REST): it accepts no visibility input and returns exactly one link, the **Private Link** as `private_url`. There is no `share`/`--share` input and no `shared` output bit
- A **Share Link** is created only by an explicit sharing step, never by **Publish**
- MCP publish tools do not create a **Revision Link** unless the agent explicitly calls **Create Revision Link**
- **Access Link Lockdown** blocks creating or resolving **Access Links**; **Publish** is content-only and never an **Access Link** operation
- **Revision Links** are not created for **Draft Revisions**
- **Share Links** always resolve to the latest **Published Revision**
- Additional **Revision Links** can be created for an already published **Revision**
- Additional **Revision Links** can target any retained published **Revision**
- **Publish** never creates a **Share Link**; sharing an **Artifact** without login is a separate explicit step, which mints or reuses the one revocable **Share Link** and returns its **Access Link Signed URL**
- The sharing step fails if the **Share Link** cannot be created (for example under **Access Link Lockdown**) without affecting the **Published Revision**
- An unlisted shared **Artifact** keeps one stable **Share Link**: the sharing step reuses an active **Share Link** before creating one, so the unlisted URL stays the same across revisions and live-updates to the latest **Published Revision**
- A **Share Link** is the unauthenticated path to choose when revocation and takedown control matter more than broad distribution
- A **Share Link** does not create a **Public URL** or **Public Version Assets**
- A **Share Link** is not the aggressive edge-cache surface
- **Public Artifact**, **Public Version**, **Public URL**, **Public ID**, **Public Resolver**, **Public Version Asset**, and **Public Offline** are planned public-distribution terms from ADR 0087; shipped CLI/MCP behavior still creates **Share Links** for no-login latest-moving handoff until the implementation specs and routes change
- A **Public Artifact** has zero or one **Public Version** at a time
- A **Public Artifact** has one stable **Public URL**
- A **Public Artifact** is created by the first public action on an **Artifact**
- The first public action atomically allocates the **Public ID**, creates the **Public URL**, and selects the initial **Public Version**
- There is no reserved **Public URL** state before the first **Public Version** is selected
- A **Public Artifact** is the unauthenticated path to choose when broad distribution and traffic spikes matter more than strict cache-level revocation
- A **Public URL** carries a **Public ID**, not the **Artifact** id
- A **Public URL** has no slug
- A **Public URL** resolves through the **Public Resolver**
- The **Public Resolver** resolves through the selected **Public Version**
- A **Public Version** resolves to exactly one **Published Revision**
- **Public Version Assets** are immutable for one **Published Revision**
- **Public Version Assets** are the aggressive edge-cache surface for broad public traffic
- Selecting a **Public Version** is the action that makes that **Published Revision** eligible for **Public Version Assets**
- **Publish**, **Share Link** creation, and **Revision Link** creation do not make **Untrusted Content** eligible for **Public Version Assets**
- The **Public Resolver** is not cached aggressively; it must use short cache lifetime or explicit purge on **Public Version** and **Public Offline** changes
- A **Public Artifact** with no selected **Public Version** is **Public Offline**
- **Public Offline** preserves the **Public URL** and **Public ID**
- **Public Offline** prevents the **Public URL** from resolving broad public content without affecting the **Artifact**, **Revisions**, **Private Link**, **Share Link**, or other **Access Links**
- **Public Offline** is a soft public-distribution control, not a hard takedown guarantee for already-cached **Public Version Assets**
- Selecting a **Public Version** brings a **Public Offline** **Public Artifact** back online without changing the **Public URL**
- **Publish Updates** do not advance a **Public Version**
- Selecting a new **Public Version** is an explicit action, not an automatic side effect of **Publish**
- An **Agent Credential** requires publish **Scope** to select a **Public Version**
- An **Agent Credential** requires publish **Scope** to put a **Public Artifact** **Public Offline**
- Moving a **Public Artifact** to a new **Public Version** does not change its **Public URL**, **Private Link**, or **Share Link**
- The CLI and MCP **Publish Result** both surface one `private_url`; the CLI still carries the full **Publish Result** (IDs, `private_url`, exact **Revision Content URL**, **Agent View** URL, **Bundle** status) in its JSON for automation
- A **Publish Result** includes separate human-view links and agent-view links
- A **Publish Result** includes **Bundle Availability** even when the **Bundle** is not ready
- A **Workspace** has exactly one **Usage Policy**
- A **Workspace** has exactly one **Plan**
- A **Plan** selects the platform-defined **Usage Policy** values that apply to a **Workspace**
- Platform hard ceilings bound every **Plan**; a higher **Plan** raises a **Workspace**'s effective caps but cannot exceed the platform maximum
- A **Plan** also determines which platform features a **Workspace** can use; a higher **Plan** may unlock features that are unavailable on a lower **Plan**
- A **Usage Policy** controls **Retention**
- A **Usage Policy** controls **Access Link** creation
- A **Usage Policy** can prevent new **Access Links** across a **Workspace**
- **Usage Policy** changes do not revoke existing **Access Links** unless a durable enforcement action does so
- A **Usage Policy** controls **Unpublished Artifact** creation
- A **Usage Policy** controls **Artifact State** storage and write limits
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
- **Pinning** is a dashboard-only action; **Agent Credentials** cannot pin regardless of **Scope**
- A **Workspace** has a platform-controlled cap on **Pinned Artifacts**
- **Pinning** is rejected when the **Workspace** is at its **Pinned Artifact** cap
- **Pinning** does not affect **Retention**
- **Pinning** does not affect **Access Link Lockdown**
- An **Artifact Rate Limit** applies per **Artifact**, counted across **Access Link** reads and **Content Origin** requests
- An **Artifact Rate Limit** does not count **Private Link** or **Agent View** reads
- An **Artifact Rate Limit** returns HTTP 429 with `Retry-After` when exceeded
- An **Artifact Rate Limit** is platform-controlled, not exposed through **Usage Policy** in the MVP
- An **Actor Rate Limit** applies per **Agent Credential** or per **Workspace Member**, counted across `api` and `upload` requests
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
- A **Workspace Member** can appear to an **Artifact** as an **Artifact User**
- An **Artifact User** can be anonymous and is not necessarily a **Workspace Member**
- An **Artifact User** exposes an artifact-scoped id, a display name, and whether it is authenticated
- An **Artifact User** does not expose email, raw provider ids, or raw **Workspace Member** ids
- An anonymous **Artifact User** is browser-scoped and artifact-scoped
- Clearing browser state can reset an anonymous **Artifact User**
- **Personal Workspace** is a human onboarding concept, not an agent-facing ownership type
- A **Workspace Member** has full authority in their **Workspace** in the MVP
- First sign-in for a new identity auto-provisions the **Personal Workspace**, the **Workspace Member** row, and a default **Agent Credential** with full publishing **Scopes**; the **Agent Credential** secret is shown once and never retrievable again
- A **Workspace** has zero or more **Audit Events**
- An **Audit Event** has exactly one **Change Summary**
- **Audit Retention** is separate from **Usage Policy**
- **Audit Events** are visible only to **Workspace Members** in the MVP
- **Unpublished Artifact** creation, **Publish**, **Deletion**, **Draft Revision** discard, **Retention** removals, **Display Metadata** changes, **Safety Warnings**, durable **Usage Policy** enforcement, **Agent Credential** changes, **Agent Credential Revocation**, **Access Link** changes, **Access Link Lockdown** changes, **Public Version** changes, and **Public Offline** changes create **Audit Events**
- **Public Version** and **Public Offline** **Audit Events** include a redacted **Change Summary** with the **Public ID**, previous **Published Revision** id or null, new **Published Revision** id or null, actor, and calling surface
- Routine **Upload Cleanup** does not create **Audit Events**
- **Upload Cleanup** creates **Audit Events** when it removes stale **Unpublished Artifact** management state
- A **Workspace** can have zero or more **Agent Credentials**
- An **Agent Credential** belongs to exactly one **Workspace**
- An **Agent Credential** has one or more **Scopes**
- A **Workspace Member** holds every **Scope** implicitly when authenticated for direct workspace control (the dashboard)
- The CLI does not receive the implicit grant: `agent-paste login` creates an **Agent Credential** capped at `publish` and `read`, so the CLI acts with that credential's **Scope** subset, never **Member-Only Scopes** (ADR 0060)
- A future delegated agent surface (MCP) that carries scopes in its own token likewise gets an explicit subset, never **Member-Only Scopes**
- A **Workspace Member** holds **Member-Only Scopes** that no **Agent Credential** can hold and that no delegated agent surface can carry
- **Agent Credential** lifecycle management requires a **Member-Only Scope**
- **Audit Event** reads require a **Member-Only Scope**
- **Workspace** administration requires a **Member-Only Scope**
- An **Agent Credential** is named by a **Workspace Member**
- A dashboard-created or default **Agent Credential** has no **Expiration** unless one is set
- A CLI-minted **Agent Credential** created by `agent-paste login` expires after 90 days
- An **Agent Credential** **Expiration** stops future use of the **Agent Credential**
- An **Agent Credential** **Expiration** does not revoke **Artifacts** or **Access Links** created with it
- **Agent Credential Revocation** stops future use of the **Agent Credential**
- **Agent Credential Revocation** does not revoke **Artifacts** or **Access Links** created with it
- An **Agent Credential** requires a read **Scope** to read private **Artifacts**
- An **Agent Credential** requires publish **Scope** to manage **Access Links**
- An **Agent Credential** requires read and publish **Scopes** to create **Access Links**
- An **Agent Credential** requires read and publish **Scopes** to mint **Access Link Signed URLs**
- An **Agent Credential** requires publish **Scope** to change **Access Link Lockdown**
- A publish **Scope** does not imply a read **Scope**
- The **Publish** action requires publish and read **Scopes**
- **Upload Sessions** require publish **Scope**, not read **Scope**
- A publish-only **Agent Credential** can prepare a **Draft Revision** for another actor to **Publish**
- A **Creator** is recorded for an **Artifact** but does not own it
- A **Creator** is recorded before first **Publish** when an **Unpublished Artifact** is created
- A **Creator** remains recorded after **Agent Credential Revocation** or **Agent Credential** **Expiration**
- A **Creator** does not change when another actor updates an **Artifact**
- An **Agent Credential** secret follows the **Agent Credential Bearer Format**
- The **Agent Credential Bearer Format** `publicId` segment is stored plaintext and indexed for credential lookup
- An **Agent Credential** secret is stored as HMAC-SHA-256 of the `secret` segment with a Worker-secret pepper; the plaintext `secret` is never persisted
- The **Agent Credential Bearer Format** `env` segment matches the deployment environment; an **Agent Credential** minted in one environment is not valid in another
- Logs and audit summaries redact the `secret` segment of any **Agent Credential Bearer Format** value and may retain `ap_pk_{env}_{publicId}…` for correlation
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
- Any **Agent Credential** with the right **Scope** in the owning **Workspace** can update an **Artifact**
- Any **Agent Credential** with the right **Scope** in the owning **Workspace** can update **Display Metadata**
- Updating a known **Artifact** does not require a read **Scope**
- Updating **Display Metadata** for a known **Artifact** does not require a read **Scope**
- The **Publish** action requires publish and read **Scopes**
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
- **Artifact State** belongs to exactly one **Artifact**
- **Artifact State** is exposed through **Private Links** and **Share Links** as one live viewer experience
- **Artifact State** is not exposed through direct **Revision Content URLs**
- **Artifact State** is not attached to any **Revision**
- **Artifact State** persists across **Publish Updates** unless explicitly reset
- **Revision Links** do not expose **Artifact State**
- **Artifact State** is mutable without creating a new **Revision**
- **Artifact State** supports basic create, read, replace, update, and delete operations
- **Artifact State** keys are opaque user-defined strings
- **Artifact State** values are JSON-serializable
- Deleting **Artifact State** is distinct from storing JSON `null`
- Replacing **Artifact State** overwrites the whole value for a key
- Updating **Artifact State** computes a new value from the current value and retries ordinary write conflicts without exposing versions to artifact code
- Every committed **Artifact State** mutation produces a **State Update**
- A **State Update** lets connected live viewers react to **Artifact State** changes without artifact-specific platform logic
- **Artifact State** subscriptions are explicit-key subscriptions
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
- An **Agent Credential** authenticates against `api` and `upload`; it is never accepted by `mcp` or by operator-only `/admin/...` routes on `api`
- `web` reaches `api` over a **Service Binding**; `mcp` reaches `api` over a **Service Binding**
- `stream` reaches `api` over a **Service Binding** to authorize each **Live Update** viewer connection
- `api` notifies `stream` on **Publish** so it can fan out a **Publish Update** to connected viewers
- `api` notifies `stream` on committed **Artifact State** changes so it can fan out a **State Update** to connected viewers
- `stream` holds no Postgres, R2, or KV binding; the **Publish Update** and **State Update** payloads it relays are platform-controlled data, not **Untrusted Content**
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
> **Domain expert:** "The **Workspace** that owns the **Agent Credential** used by the agent."
> **Dev:** "Is **Creator** recorded only after first **Publish**?"
> **Domain expert:** "No — **Creator** is recorded when the **Artifact** management record is created."
> **Dev:** "If the creating **Agent Credential** expires or is revoked, does the **Creator** disappear?"
> **Domain expert:** "No — **Creator** is historical attribution, not current authority."
> **Dev:** "Does **Creator** change when another agent publishes a new **Revision**?"
> **Domain expert:** "No — later actors are recorded through **Audit Events**."
> **Dev:** "Can trusted **Agent Credentials** upload trusted HTML?"
> **Domain expert:** "No — **Untrusted Content** remains untrusted even when uploaded with a valid **Agent Credential**."
> **Dev:** "Can **Untrusted Content** include JavaScript?"
> **Domain expert:** "Yes — JavaScript is allowed but remains **Untrusted Content**."
> **Dev:** "When an **Artifact** is updated, should existing links change?"
> **Domain expert:** "No — **Private Links** and **Share Links** stay stable and show the latest **Published Revision**."
> **Dev:** "Is a **Share Link** a public URL?"
> **Domain expert:** "No — a **Share Link** is unlisted access; a **Public Artifact** is intentionally published for broad viewing."
> **Dev:** "Does **Publish** automatically update a **Public Artifact**?"
> **Domain expert:** "No — a **Public Artifact** changes only when a new **Public Version** is selected."
> **Dev:** "Does selecting a new **Public Version** change the **Public URL**?"
> **Domain expert:** "No — the **Public URL** is stable; it resolves through whichever **Public Version** is currently selected."
> **Dev:** "Does the **Public URL** expose the **Artifact** id?"
> **Domain expert:** "No — it carries a separate **Public ID**."
> **Dev:** "Should a **Public URL** include a title slug?"
> **Domain expert:** "No — the **Public ID** is the canonical URL segment."
> **Dev:** "Can an agent reserve a **Public URL** before choosing a **Public Version**?"
> **Domain expert:** "No — the first public action atomically creates the **Public URL** and selects the initial **Public Version**."
> **Dev:** "Can an agent move a **Public Artifact** to the latest **Published Revision** on every publish?"
> **Domain expert:** "Only when it takes the explicit action to select a new **Public Version**; ordinary **Publish** does not move public viewing."
> **Dev:** "Is selecting a **Public Version** human-only?"
> **Domain expert:** "No — an **Agent Credential** can select a **Public Version** with publish **Scope**."
> **Dev:** "If a public page needs to come down briefly, do we delete or rotate the **Public URL**?"
> **Domain expert:** "No — put the **Public Artifact** **Public Offline**. The **Public URL** and **Public ID** stay reserved, and selecting a **Public Version** brings it back online."
> **Dev:** "Does **Public Offline** affect private or unlisted access?"
> **Domain expert:** "No — it only stops the **Public URL** from serving broad public content. **Private Links**, **Share Links**, and other **Access Links** are separate controls."
> **Dev:** "Do we cache the stable **Public URL** hard?"
> **Domain expert:** "No — cache immutable **Public Version Assets** aggressively. Keep the **Public Resolver** short-lived or explicitly purged so pointer changes and **Public Offline** take effect quickly."
> **Dev:** "Should I make something **Public** if I might need strict takedown later?"
> **Domain expert:** "No — use a **Share Link** when revocation and takedown control matter. Use **Public** when broad distribution and traffic-spike handling are the priority."
> **Dev:** "Does **Public Offline** mean every cached public asset disappears immediately?"
> **Domain expert:** "No — it is a soft public-distribution control for the **Public Resolver**, not a hard takedown guarantee for already-cached **Public Version Assets**."
> **Dev:** "What is the hard takedown path for a **Public Artifact**?"
> **Domain expert:** "**Platform Lockdown**. It is operator-only and blocks the **Public Resolver** and **Public Version Assets**, using cache purge and deny controls where available."
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
> **Dev:** "Can a read-only **Agent Credential** see **Draft Revisions**?"
> **Domain expert:** "No — draft access is a management capability tied to publish **Scope**."
> **Dev:** "Can an agent discard a **Draft Revision**?"
> **Domain expert:** "Yes — an **Agent Credential** with publish **Scope** can discard it without affecting the **Published Revision**."
> **Dev:** "Does discarding a **Draft Revision** create an **Audit Event**?"
> **Domain expert:** "Yes — finalized draft state is durable management state."
> **Dev:** "Can only the original **Creator** update an **Artifact**?"
> **Domain expert:** "No — update permission comes from the **Agent Credential Scope** within the owning **Workspace**."
> **Dev:** "Can an agent update **Display Metadata**?"
> **Domain expert:** "Yes — an **Agent Credential** with the right **Scope** can update it."
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
> **Domain expert:** "Yes — **Publish** is content-only and can create a new **Revision**. Lockdown blocks creating new **Access Links**, so the separate sharing step for a **Share Link** and explicit **Revision Links** fail while it is active."
> **Dev:** "Can another agent use a **Share Link** without an **Agent Credential**?"
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
> **Domain expert:** "Two steps. **Publish** the folder — it is content-only and private, and returns the **Private Link** as `private_url`. Then, only if the user wants an unlisted no-login link, run the explicit sharing step. That mints or reuses the **Artifact**'s one **Share Link** and returns its **Access Link Signed URL**."
> **Dev:** "What does an agent get back after **Publish**?"
> **Domain expert:** "One `private_url` — the login-walled `/v/<artifactId>` viewer. The CLI also carries the full **Publish Result** in its JSON — IDs, `private_url`, direct **Revision Content URL**, **Agent View** URL, **Bundle** status, and any **Safety Warnings** — for automation. There is no `shared` bit and no `share` input."
> **Dev:** "Does **Publish** make an **Artifact** shareable by default?"
> **Domain expert:** "No — **Publish** is content-only and private on every surface; nothing is reachable without login. Unlisted sharing is a separate explicit step, and `private_url` is always the authenticated **Private Link**."
> **Dev:** "What if the **Share Link** cannot be created during the sharing step?"
> **Domain expert:** "The sharing step fails without touching the **Published Revision** or its **Private Link**."
> **Dev:** "Can a **Share Link** be pinned to the current **Published Revision**?"
> **Domain expert:** "No — **Share Links** always follow the latest **Published Revision**; use a **Revision Link** to pin one."
> **Dev:** "Can an agent create a **Share Link** without publishing again?"
> **Domain expert:** "Yes — the sharing step works on any already-published **Artifact**; it never needs a re-publish."
> **Dev:** "Can an agent create a **Share Link** while **Access Link Lockdown** is active?"
> **Domain expert:** "No — lockdown prevents creating new **Access Links**."
> **Dev:** "Does **Publish** create a pinned link for the exact **Revision**?"
> **Domain expert:** "No — **Publish** returns only the latest-following **Private Link**. For an unlisted latest-moving link an agent runs the sharing step to mint the **Share Link**; for a pinned URL of the exact **Revision** it calls **Create Revision Link**."
> **Dev:** "Can an agent create another **Revision Link** for the same **Revision**?"
> **Domain expert:** "Yes — additional **Revision Links** can be created for separate audiences."
> **Dev:** "Can an agent create an additional **Revision Link** during **Access Link Lockdown**?"
> **Domain expert:** "No — lockdown prevents creating new **Access Links**."
> **Dev:** "Can an agent create a **Revision Link** for a removed or draft **Revision**?"
> **Domain expert:** "No — **Revision Links** can target only retained published **Revisions**."
> **Dev:** "What if **Usage Policy** blocks the required **Revision Link**?"
> **Domain expert:** "That failure applies only when the agent explicitly asks to create a pinned **Revision Link**. Plain **Publish** does not create one."
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
> **Domain expert:** "A **Workspace Member** creates a named, scoped **Agent Credential** and gives the secret to the agent."
> **Dev:** "Does an agent need to know whether a **Workspace** is personal?"
> **Domain expert:** "No — agents only need the owning **Workspace**."
> **Dev:** "Does expiring an **Agent Credential** remove what it created?"
> **Domain expert:** "No — **Expiration** stops future credential use, but created **Artifacts** and **Access Links** remain."
> **Dev:** "Does **Agent Credential Revocation** remove what the credential created?"
> **Domain expert:** "No — it stops future credential use, but created **Artifacts** and **Access Links** remain."
> **Dev:** "Do **Scopes** limit **Workspace Members**?"
> **Domain expert:** "No — through the dashboard a **Workspace Member** holds every **Scope** implicitly, including **Member-Only Scopes** that an **Agent Credential** cannot hold. Through the CLI the same person acts with an **Agent Credential** capped at `publish` and `read`; MCP carries an explicit token **Scope** subset. Neither path ever includes **Member-Only Scopes**."
> **Dev:** "Does **Agent Credential Revocation** create an **Audit Event**?"
> **Domain expert:** "Yes — credential lifecycle changes are security-relevant."
> **Dev:** "Can a publishing **Agent Credential** read private **Artifacts**?"
> **Domain expert:** "Only if it has a read **Scope**."
> **Dev:** "Can any publishing **Agent Credential** manage **Access Links**?"
> **Domain expert:** "Yes — publish **Scope** manages **Access Links**."
> **Dev:** "Can a publish-only **Agent Credential** create **Access Links**?"
> **Domain expert:** "No — creating **Access Links** requires both read and publish **Scopes**."
> **Dev:** "Can a publish-only **Agent Credential** mint **Access Link Signed URLs**?"
> **Domain expert:** "No — minting **Access Link Signed URLs** requires both read and publish **Scopes**."
> **Dev:** "Does publish **Scope** include read **Scope**?"
> **Domain expert:** "No — **Scopes** are independent."
> **Dev:** "Can an **Agent Credential** publish with publish **Scope** but no read **Scope**?"
> **Domain expert:** "No — the **Publish** action requires publish and read **Scopes**."
> **Dev:** "Does creating an **Upload Session** require read **Scope**?"
> **Domain expert:** "No — **Upload Sessions** create drafts, so publish **Scope** is enough."
> **Dev:** "Can one agent upload a draft and another publish it?"
> **Domain expert:** "Yes — a publish-only **Agent Credential** can prepare a **Draft Revision** for another actor to **Publish**."
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
> **Dev:** "Can an **Agent Credential** update a known **Artifact** without reading it first?"
> **Domain expert:** "Yes — update authority comes from the publish **Scope**, not the read **Scope**."
> **Dev:** "Can an **Agent Credential** publish without read **Scope**?"
> **Domain expert:** "No — **Publish** returns a **Revision Content URL** and **Agent View** URL, so read **Scope** is required."
> **Dev:** "Does updating **Display Metadata** require a read **Scope**?"
> **Domain expert:** "No — publish **Scope** is enough for a known **Artifact**."
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
> **Dev:** "Can an **Agent Credential** with read **Scope** read **Audit Events**?"
> **Domain expert:** "No — **Audit Event** reads require a **Member-Only Scope**, which only a dashboard-authenticated **Workspace Member** carries. An **Agent Credential** cannot hold it; CLI and MCP tokens cannot carry it."
> **Dev:** "Do **Access Link** changes create **Audit Events**?"
> **Domain expert:** "Yes — they are unauthenticated access grants, so lifecycle changes are security-relevant."
> **Dev:** "Do **Public Version** changes and **Public Offline** changes create **Audit Events**?"
> **Domain expert:** "Yes — they are important public access events. The **Change Summary** records the **Public ID**, old and new **Published Revision** ids or null, actor, and calling surface."
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
