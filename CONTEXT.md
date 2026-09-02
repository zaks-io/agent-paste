# Agent Artifact Publishing

Agent Paste lets an agent put files on the web and return one URL that works.

For repository ownership and lookup paths, see
[`docs/agents/repo-navigation.md`](./docs/agents/repo-navigation.md). Current
behavior lives in [`docs/specs/`](./docs/specs/); ADRs record decision history.

## Language

<a id="artifact"></a>
**Artifact**:
A durable, addressable folder-like package of uploaded files. It has one stable
**Artifact URL** after first publish.
_Avoid_: paste, post, share record

<a id="revision"></a>
**Revision**:
An immutable complete file tree saved for an **Artifact**. A Revision may inherit
unchanged files from its parent Revision.
_Avoid_: version, snapshot

<a id="draft-revision"></a>
**Draft Revision**:
A finalized Revision that is not externally visible yet.
_Avoid_: partial upload, pending files

<a id="published-revision"></a>
**Published Revision**:
The Revision currently served by the **Artifact URL**.
_Avoid_: live version

<a id="publish"></a>
**Publish**:
The atomic operation that makes one complete Revision current and returns the
Artifact URL. Publish is the only operation that exposes a Draft Revision.
_Avoid_: share, make public, set visibility

<a id="artifact-url"></a><a id="artifact-viewer"></a>
**Artifact URL**:
The no-login top-level website returned by Publish. Production shape:
`https://{xxxxx-xxxxx-xxxxx-xxxxx}.agent-paste.link/`. Preview shape:
`https://{xxxxx-xxxxx-xxxxx-xxxxx}-preview.agent-paste.link/`. It keeps the same hostname
when the Artifact advances to a new Published Revision.
_Avoid_: Artifact Viewer, Private Link, Access Link, Share Link, app page

<a id="capability-id"></a>
**Capability ID**:
The 23-character grouped base32 hostname label in a new Artifact URL. Its 19
random symbols carry 95 bits of entropy and its final symbol checks for input
errors. Legacy 32-character lowercase hexadecimal IDs remain valid. Possession
grants read access, so logs and telemetry treat it as credential material.
_Avoid_: slug, public id

<a id="capability-manifest"></a>
**Capability Manifest**:
The small R2 object that binds one Capability ID to a signed exact-Revision
content token and Entrypoint. API writes it; Content reads it.
_Avoid_: redirect record, cache authority

<a id="artifact-console"></a>
**Artifact Console**:
The authenticated dashboard management page at `/artifacts/{artifactId}`. It
shows metadata, Revisions, warnings, lifecycle actions, and the Artifact URL. It
never renders the Artifact.
_Avoid_: Artifact URL, viewer

<a id="upload-session"></a>
**Upload Session**:
A temporary workflow that collects files and finalizes one complete Revision.
_Avoid_: upload batch

<a id="entrypoint"></a>
**Entrypoint**:
The file served at `/` on an Artifact URL, normally `index.html`.
_Avoid_: homepage route

<a id="bundle"></a>
**Bundle**:
An archive of one retained Revision.
_Avoid_: Artifact URL

<a id="workspace"></a>
**Workspace**:
The tenant boundary that owns Artifacts, credentials, policy, usage, and audit
history.
_Avoid_: account, organization when the code means tenant

<a id="ephemeral-workspace"></a>
**Ephemeral Workspace**:
A constrained, short-lived Workspace created for accountless publish. Its
Artifacts may be claimed before automatic deletion.
_Avoid_: anonymous account

<a id="claim-token"></a>
**Claim Token**:
A one-time credential carried separately in the claim URL fragment. It is never
part of an Artifact URL and never reaches Content.
_Avoid_: Artifact credential

<a id="agent-credential"></a>
**Agent Credential**:
A revocable Workspace-scoped credential used by CLI, API, or MCP.
_Avoid_: user session

<a id="scope"></a>
**Scope**:
An allowed action family on an Agent Credential, including read, publish, and
admin.
_Avoid_: role

<a id="platform-lockdown"></a>
**Platform Lockdown**:
An operator-controlled reversible block on Artifact or Workspace reads. It fails
closed before bytes are served.
_Avoid_: deletion

<a id="auto-deletion"></a>
**Auto Deletion**:
Scheduled removal of expired ephemeral or retention-governed Artifact data.
_Avoid_: expiration when referring to the cleanup action

<a id="untrusted-content"></a>
**Untrusted Content**:
Uploaded Artifact code and assets. It executes top-level only on its own
capability origin, never in the trusted app origin.
_Avoid_: dashboard content

<a id="legacy-signed-content-url"></a>
**Legacy Signed Content URL**:
An expiring `usercontent.agent-paste.sh/v/...` URL issued before the one-URL
architecture. Existing URLs may expire naturally, but current publish surfaces
do not mint or return them.
_Avoid_: Artifact URL

<a id="retired-viewer-surface"></a>
**Retired Viewer Surface**:
The removed iframe viewer, Access Link, Share Link, Revision Link, Private Link,
visibility command, and live viewer push architecture. Historical schema and
migration code may remain, but no current route or client exposes it.

## Apps and Workers

<a id="apex"></a>
**Apex**:
Public marketing and documentation Worker at `agent-paste.sh`.

<a id="web"></a>
**Web**:
Authenticated management console at `app.agent-paste.sh`. It manages Artifacts
but never serves or embeds their bytes.

<a id="api"></a>
**API**:
Control-plane Worker that authenticates requests, commits publish state, writes
Capability Manifests, and serves management APIs.

<a id="upload"></a>
**Upload**:
Worker that accepts resumable file uploads into private R2.

<a id="content"></a>
**Content**:
Data-plane Worker on Artifact capability hosts and the legacy signed-content
host. It validates hostnames and tokens, reads manifests, decrypts bytes, and
applies content headers.

<a id="jobs"></a>
**Jobs**:
Worker for lifecycle, retention, cleanup, and other asynchronous work.

<a id="stream"></a>
**Stream**:
A retired live-viewer Worker retained only as migration history. API and Web do
not call it.

<a id="cli"></a>
**CLI**:
The primary agent publishing client. `agent-paste publish <path>` returns the
Artifact URL.

<a id="mcp"></a>
**MCP**:
The remote agent surface for tools that cannot run the CLI. Its publish tools
return the same contract as CLI and REST.

## Runtime primitives

- **Postgres** is authoritative for Workspace, Artifact, Revision, credential,
  billing, audit, and lifecycle metadata.
- **R2** stores encrypted Artifact bytes, Bundles, and Capability Manifests.
- **KV** holds non-authoritative deny and cache state where immediate read-path
  enforcement needs it.
- A **Service Binding** is trusted Worker-to-Worker transport, not product
  authority.
- **CSP** on claimed Artifact websites is compatibility-oriented for generated
  pages: inline scripts, eval, external HTTPS dependencies, data and blob
  assets, dedicated workers, fetch, and secure WebSockets are allowed.
- **CSP** on ephemeral Artifact websites is static: scripts, connections,
  workers, forms, frames, objects, and base-URL changes are blocked until claim.
- Service workers are unsupported on every Artifact tier.
- Every Artifact response denies framing with `frame-ancestors 'none'` and
  `X-Frame-Options: DENY`.

## Relationships

- An Artifact belongs to exactly one Workspace.
- An Artifact has zero or more immutable Revisions.
- An Artifact has exactly one Published Revision after first Publish.
- An Artifact has one Artifact URL and one Capability ID while published; both
  are absent before first Publish and after revocation.
- Publish returns exactly `artifact_id`, `revision_id`, `title`, `url`, and
  `expires_at` on deployed authenticated surfaces.
- Ephemeral publish returns the same Artifact URL plus separate claim material.
- Publishing a new Revision keeps the Artifact URL and atomically advances its
  Capability Manifest.
- A deployed Publish fails if it cannot produce and persist the Artifact URL.
- The Artifact URL opens without login and without a sharing step.
- Web links to the Artifact URL; it does not proxy, wrap, or iframe it.
- Content accepts only the exact environment-specific capability-host grammar.
- Capability IDs and legacy signed URLs are never stored in ordinary logs.
- Platform Lockdown and deletion stop Artifact reads without relying on cache
  expiry.
- Claiming changes ownership and retention, not the Artifact URL.
- Legacy signed content URLs remain exact-Revision and expiration-bound.
- Retired Viewer Surface terms must not appear in current UI, CLI, MCP, REST, or
  agent documentation.

## Example dialogue

> **Agent:** "What do I return after publishing?"
>
> **Domain expert:** "Return `url`. It is the Artifact website and opens without
> login. There is no second sharing operation."

> **Developer:** "Where should Artifact HTML render?"
>
> **Domain expert:** "Top-level on the Artifact capability subdomain. Never in an
> iframe or under the app origin."

> **Developer:** "What happens when I publish another Revision?"
>
> **Domain expert:** "The same Artifact URL serves the new Published Revision on
> refresh."

> **Developer:** "Can production fall back to a signed usercontent URL if the
> manifest write fails?"
>
> **Domain expert:** "No. That is a publish failure. Local development alone may
> use the legacy fallback because localhost has no wildcard DNS."

## Flagged ambiguities

- Public high-traffic distribution remains a separate future design. Do not
  reintroduce a second sharing URL to approximate it.
- Historical Access Link tables and Stream code require a dedicated data
  migration before physical removal. Their presence does not make them a
  current product surface.
