import { API_BASE_URL, APP_BASE_URL, MCP_BASE_URL } from "./copy";

export const AGENTS_MD = `# agent-paste for agents

agent-paste gives AI agents a durable, addressable place to publish work
products. Publish returns the authenticated Artifact URL as \`View\` by default.
Create a Share Link and return \`access_link_url\` only when the user explicitly
asks for a public/shareable link. Do not send users to the Revision Content URL
as the final live page.

This document is the longer-form companion to [/llms.txt](/llms.txt). It is
written for an agent reading the apex domain at request time.

For complete public usage docs, fetch [/docs.md](/docs.md) or the full corpus at
[/llms-full.txt](/llms-full.txt). Human-readable docs start at [/docs](/docs).

## Mental model

agent-paste has three objects an agent needs to know:

- **Artifact** - A named, addressable container. Identified by an Artifact ID
  shaped like \`art_01HZ8K2X9NPQR3VW7TYBE5MCDF\`. Belongs to one Workspace.
- **Revision** - An immutable saved state of an Artifact. A new publish
  appends a new Published Revision. Old Revisions stay reachable through
  Revision Links.
- **Access Link** - The revocable, unlisted grant family for unauthenticated
  read access. Share Links and Revision Links are Access Link types. An Access
  Link is the durable grant; an Access Link Signed URL is the URL string minted
  from that grant.
- **Artifact URL** - The authenticated Artifact detail URL for workspace
  management and the default post-publish \`View\` URL.
- **Revision Content URL** - A signed \`usercontent.agent-paste.sh/v/...\` URL
  for the exact Revision returned by publish. It expires and does not Live
  Update.
- **Share Link** - An Access Link type that follows the latest Published
  Revision. It opens the Artifact
  Viewer at \`${APP_BASE_URL}/al/{public_id}#...\`, follows the latest Published
  Revision, and can be revoked without deleting the Artifact.
- **Access Link Signed URL** - The URL string minted from an Access Link. The
  one minted from a Share Link is the public/shareable live page URL to return
  only when the user explicitly asks for sharing.

## CLI quickstart

Before choosing a publish mode, check whether the user already has auth:

\`\`\`
npx @zaks-io/agent-paste whoami --json
\`\`\`

\`whoami\` exits \`0\` whether or not you are signed in; do not branch on the exit
code. Check the JSON: \`{"authenticated": false}\` means no usable credential,
while a signed-in response carries the resolved Workspace, actor, and scopes.

If \`whoami\` reports you are signed in, publish normally. If not and the user can
interact, run \`npx @zaks-io/agent-paste login\` once, then publish. Login runs a browser
OAuth flow and provisions its own scoped key, so there is no API key to copy or
paste. Publish returns the authenticated Artifact URL as \`View\` by default.
Public sharing is explicit: pass CLI \`--share\`, REST \`{ "share": true }\`, or
MCP \`share:true\`/create a Share Link only when the user asks for a
public/shareable URL. JSON/REST output also carries diagnostic Artifact IDs,
Revision IDs, and snapshot URLs for automation.

\`\`\`
npx @zaks-io/agent-paste login
npx @zaks-io/agent-paste whoami
npx @zaks-io/agent-paste publish ./report
# => View https://app.agent-paste.sh/artifacts/art_...
\`\`\`

Human-readable CLI output prints the authenticated app URL as \`View\`. It does
not print Artifact IDs, Revision IDs, or direct content URLs:

\`\`\`
✓ Published "report"

  View      ${APP_BASE_URL}/artifacts/art_...
  Expires   2026-06-20
  Upload    3/3 uploaded, 0 reused · 42 KB sent, 0 B cached

  → open ${APP_BASE_URL}/artifacts/art_...
\`\`\`

JSON output has these URL fields:

- \`artifact_url\` - authenticated workspace Artifact detail URL and default
  \`View\` URL.
- \`access_link_url\` - Access Link Signed URL from an explicitly created Share
  Link or Revision Link.
- \`revision_content_url\` - exact signed Content Origin URL for this Revision.
  It expires, does not Live Update, and direct HTML opened there is inert raw byte
  delivery rather than the product viewer.
- \`agent_view_url\` - machine-readable Agent View JSON for tools.

Publish creates a new Artifact by default. To append and publish a new Revision
on an existing Artifact, pass \`--artifact-id art_...\`.

If the user asks for a public/shareable link, create a Share Link and return
\`access_link_url\`: the Access Link Signed URL minted from that Share Link. In
CLI this means passing \`--share\`; in REST this means sending
\`{ "share": true }\`; in MCP this means setting \`share:true\` or using
\`create_share_link\`. Do not return the
\`usercontent.agent-paste.sh/v/...\` Revision Content URL as the final answer.

## Ephemeral publish fallback

Use \`--ephemeral\` only when \`whoami\` reports \`"authenticated": false\` and no
login or \`AGENT_PASTE_API_KEY\` is available, or when the user explicitly asks for
accountless publish. It ignores stored login credentials and environment API
keys, so do not use it after a successful auth check. It is suitable for
non-interactive work such as text, markdown, images, and static HTML/CSS.

\`\`\`
npx @zaks-io/agent-paste publish ./report --ephemeral
\`\`\`

Ephemeral is not the Free Plan. It is an unclaimed restricted tier with low
write caps, \`noindex\`, a 24 hour lifetime, and script-disabled content serving.
Publish prints a one-time **Claim Token** as a claim link
(\`${APP_BASE_URL}/claim#<token>\`). A signed-in human opens that link to
reparent the Artifact into their Workspace and keep it. The token rides the URL
**hash** only: it never appears in the query string or in any public Access Link
Signed URL.

Unclaimed ephemeral HTML is script-disabled. Text, markdown, images, and static
HTML/CSS render, but JavaScript does not run. After claim, newly minted viewer
URLs can run interactive HTML inside the controlled Artifact Viewer. For an
interactive page, browser app, or visualization that needs JavaScript, use
authenticated publish rather than \`--ephemeral\`.

## REST entry points

Base: \`${API_BASE_URL}\`

- \`GET /v1/whoami\` - verify the calling API key, return actor + workspace.
- \`GET /v1/artifacts/{id}/agent-view\` - agent-optimized JSON view of an
  artifact: file tree, \`revision_content_url\`, signed file URLs.
- \`GET /v1/artifacts/{id}/revisions/{rev}/agent-view\` - same view, pinned to
  a specific Revision.
- \`GET /v1/public/agent-view/{token}\` - public counterpart, no auth, scoped
  by a signed Agent View token.
- \`GET /v1/usage-policy\` - current quotas and Auto Deletion bounds.

## Authentication

The CLI and REST API authenticate with an **API key**; the MCP server
authenticates with **OAuth** (WorkOS). They are separate credentials.

- **CLI:** \`npx @zaks-io/agent-paste login\` completes a browser OAuth flow and
  stores a scoped API key for you. Nothing to copy or paste.
- **Ephemeral:** \`npx @zaks-io/agent-paste publish --ephemeral\` is the
  restricted fallback when \`whoami\` reports \`"authenticated": false\` and no
  login or key is available. The
  CLI self-provisions a short-lived, low-cap key and returns a one-time Claim
  Token; a signed-in human redeems it later to keep the Artifact.
- **REST:** send \`Authorization: Bearer <api-key>\`. Mint a key for CI or
  headless use on the dashboard API Keys page
  ([${APP_BASE_URL}/keys](${APP_BASE_URL}/keys)), or set \`AGENT_PASTE_API_KEY\`
  in the environment. API keys carry \`publish\` and \`read\` scopes.
- **MCP:** OAuth bearer only. The MCP server verifies a WorkOS-issued access
  token; an API key is not accepted here. Product capabilities are derived from
  the authenticated Workspace Member in \`api\`, not from OAuth token scopes.

## MCP server

Base: \`${MCP_BASE_URL}\`

Use MCP when the agent's host can connect to a remote MCP server but cannot run
the CLI, install npm packages, or use a local keychain. MCP tools publish, read,
revise, delete, and share Artifacts through the same Agent View model as the
REST API.

Connect \`${MCP_BASE_URL}\` in the host, complete OAuth, then call \`whoami\`
first. The WorkOS user must already belong to a Workspace; dashboard sign-in or
\`agent-paste login\` creates that member row.

Twelve tools, scoped by member-derived capabilities:

Read (\`read\`):

- \`whoami\` - return the authenticated member, workspace, and derived scopes
  (no scope required).
- \`list_artifacts\` - list Artifacts in the authenticated workspace.
- \`read_artifact\` - read the latest Agent View for an Artifact.
- \`list_revisions\` - list Revisions for an Artifact.

Write (\`write\`):

- \`publish_artifact\` - publish a new text-only Artifact without creating a
  public link by default. Set \`share:true\` only when the user explicitly asks
  for a public/shareable Access Link.
- \`add_revision\` - add and publish a new Revision to an Artifact without
  creating or reusing a Share Link by default. Set \`share:true\` only when the
  user explicitly asks for a public/shareable Access Link.
- \`delete_artifact\` - delete an Artifact.
- \`update_display_metadata\` - update an Artifact's display title.

Links (\`share\`):

- \`create_share_link\` - create a Share Link and mint its Access Link Signed
  URL (also needs \`read\`). This is the link to give users.
- \`create_revision_link\` - create and mint a snapshot Access Link for a
  specific Revision (also needs \`read\`). Use only when the user asked for a
  fixed Revision.
- \`list_access_links\` - list an Artifact's Share Links and Revision Links
  (also needs \`read\`).
- \`revoke_access_link\` - revoke a Share Link or Revision Link.

Limits: MCP publish is text-only today. Use the CLI or REST API for folder
uploads, binary files, standalone Bundle downloads, workspace settings, billing,
and lockdown controls. Artifact lifetime follows Workspace Auto Deletion policy;
MCP callers do not choose TTL.

## Where to find more

- Human docs: [https://agent-paste.sh/docs](https://agent-paste.sh/docs)
- Markdown docs: [https://agent-paste.sh/docs.md](https://agent-paste.sh/docs.md)
- Full machine-readable docs: [https://agent-paste.sh/llms-full.txt](https://agent-paste.sh/llms-full.txt)
- Dashboard (humans): [${APP_BASE_URL}](${APP_BASE_URL})
- REST API: [${API_BASE_URL}](${API_BASE_URL})
- MCP server: [${MCP_BASE_URL}](${MCP_BASE_URL})
`;
