# MVP Acceptance Matrix

The MVP is implementation-ready when these scenarios can be automated locally and in preview. Each scenario should become one or more integration tests.

## Identity And Workspace

| Scenario | Expected Result |
|---|---|
| First verified Auth0 sign-in | Creates Personal Workspace, Workspace Member, Usage Policy, and default API Key. |
| Unverified Auth0 email | Sign-in rejected; no Workspace is created. |
| First-run key card copied then dismissed | Secret is not retrievable after dismissal or reload. |
| `agent-paste login` | CLI stores refreshable Auth0 session with `write read share`, no Member-Only Scopes. |
| `AGENT_PASTE_API_KEY` present | CLI uses API Key instead of stored login. |

## Publishing

| Scenario | Expected Result |
|---|---|
| Publish single HTML file | Creates Artifact, Revision, Revision Link, Private Link, Agent View, pending Bundle. |
| Publish folder with `index.html` | Entrypoint inferred and subresources load from content prefix. |
| Publish folder without obvious entrypoint | Fails with `entrypoint_not_in_revision` or validation error; no Published Revision changes. |
| Publish with incompatible Render Mode | Fails with `render_mode_incompatible`. |
| Publish update to existing Artifact | New Revision becomes Published Revision; old Revision Link stays pinned. |
| Retry same publish idempotency key | Returns same durable identifiers without duplicate rows. |

## Reading And Sharing

| Scenario | Expected Result |
|---|---|
| Resolve Revision Link | Returns Agent View for pinned Revision and content prefix. |
| Resolve Share Link after update | Returns latest Published Revision. |
| Drop URL fragment before resolve | Generic `not_found`. |
| Revoke Access Link | Future resolve returns generic `not_found`; management list shows revoked metadata. |
| Enter Access Link Lockdown | All Access Links fail; Private Link still works. |
| Lift Access Link Lockdown | Non-revoked, non-expired links work again after re-minting. |
| Delete Artifact | Private Link and Access Links stop resolving immediately. |

## Content Origin

| Scenario | Expected Result |
|---|---|
| HTML content | Served with base CSP and `nosniff`. |
| SVG content | Served with SVG-specific CSP. |
| Unknown extension | Downloads as `application/octet-stream`. |
| Expired content token | Generic `not_found`. |
| Denylisted artifact token | Generic `not_found`. |
| Markdown Render Mode | Renderer page fetches and renders Markdown from content origin only. |
| Directory Render Mode | Renderer shows file listing with signed-prefix-relative links. |

## Management

| Scenario | Expected Result |
|---|---|
| Update Display Metadata | Title/description change without creating Revision. |
| Create API Key with `write read share` | Secret shown once; row stores only HMAC. |
| Attempt API Key with Member-Only Scope | Rejected. |
| Revoke API Key | Future use fails; created Artifacts remain. |
| Pin Artifact at cap | 51st pin rejected. |
| Lower Auto Deletion setting | Setting accepted within 1..90 day bounds. |
| Read audit as API Key | Rejected. |

## Jobs

| Scenario | Expected Result |
|---|---|
| Bundle generation success | Bundle Availability becomes `ready` with URL and size. |
| Bundle exceeds cap | Bundle Availability becomes `failed`; Publish remains successful. |
| Safety scan stub | Warnings are replaced under scanner id/version and exposed in Agent View. |
| Auto Deletion due | Artifact enters deleted state, Audit Event written, purge enqueued. |
| Upload Session expiry | Upload bytes are purged; no Artifact row leaks for abandoned sessions. |
| Idempotency GC | Completed records older than 24 hours are deleted. |

## MCP

| Scenario | Expected Result |
|---|---|
| OAuth metadata discovery | Protected resource metadata advertises Auth0 and scopes. |
| MCP publish text | Creates single-file text Artifact with required Revision Link. |
| MCP publish binary attempt | Rejected by tool schema. |
| MCP insufficient scope | JSON-RPC error uses `insufficient_scope` and re-consent challenge. |
| MCP read Artifact | Returns Agent View and inline text content for text Render Modes. |

## Security Boundaries

| Scenario | Expected Result |
|---|---|
| Cross-workspace Artifact id | Authenticated caller gets `artifact_not_found`. |
| Access Link wrong workspace | Unauthenticated caller gets generic `not_found`. |
| API Key on operator route | Rejected before scope checks. |
| `content` Worker has no DB binding | Verified by generated Worker binding types. |
| `/al/*` imports auth module | Lint fails. |
| Logs contain Access Link fragment | Test fails. |
