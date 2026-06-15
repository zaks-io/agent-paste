import { APP_BASE_URL, MCP_BASE_URL } from "./copy";

export const AGENTS_MD = `# agent-paste for agents

agent-paste gives AI agents a durable, addressable place to publish work
products. Publish is content-only and private: it returns one \`private_url\` to
hand the user — the login-walled clean viewer at \`/v/<artifactId>\` for the
owning Workspace Member. To make an Artifact public, run the separate make-public
step (\`agent-paste make-public\` on the CLI, \`make_public\` on MCP), which returns
the public no-login Share Link. Do not send users to the Revision Content URL as
the final live page.

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
- **Private Link** - The login-walled clean viewer at
  \`${APP_BASE_URL}/v/{artifact_id}\` for a Workspace Member. It is the
  \`private_url\` publish returns and the default post-publish \`View\` URL.
- **Artifact Console** - The dashboard-only management page at
  \`${APP_BASE_URL}/artifacts/{artifact_id}\`. It is never returned by publish or
  any agent surface; it is for the owner managing links and revisions.
- **Revision Content URL** - A signed \`usercontent.agent-paste.sh/v/...\` URL
  for the exact Revision returned by publish. It expires and does not Live
  Update.
- **Share Link** - An Access Link type that follows the latest Published
  Revision. It opens the Artifact
  Viewer at \`${APP_BASE_URL}/al/{public_id}#...\`, follows the latest Published
  Revision, and can be revoked without deleting the Artifact. It is created only
  by the make-public step, never by publish.
- **Access Link Signed URL** - The URL string minted from an Access Link. The
  one minted from a Share Link is the public, no-login live page URL, returned by
  the make-public step.

## CLI quickstart

Before choosing a publish mode, check whether the user already has auth:

\`\`\`
npx @zaks-io/agent-paste whoami --json
\`\`\`

\`whoami\` exits \`0\` whether or not you are signed in; do not branch on the exit
code. Check the JSON: \`{"authenticated": false}\` means no usable credential,
while a signed-in response carries the resolved Workspace, actor, and scopes.

If \`whoami\` reports you are signed in, publish normally. If not and the user can
interact, run \`npx @zaks-io/agent-paste login\` once, then publish. Login runs a
browser OAuth flow and stores its own scoped local credential, so there is
nothing to copy or paste. Publish is content-only and private: it returns the
\`private_url\` clean viewer as \`View\`. Making an Artifact public is the separate
\`npx @zaks-io/agent-paste make-public <artifact-id>\` step, used only when the
user asks for a public/shareable URL. JSON output also carries diagnostic
Artifact IDs, Revision IDs, and snapshot URLs for automation.

\`\`\`
npx @zaks-io/agent-paste login
npx @zaks-io/agent-paste whoami
npx @zaks-io/agent-paste publish ./report
# => View https://app.agent-paste.sh/v/art_...
\`\`\`

Human-readable CLI output leads with the \`private_url\` clean viewer as \`View\`, then
prints an \`Update\` line: the one command to revise this Artifact in place. The
\`Update\` line is the explicit revise handle; Revision IDs and direct content URLs
stay in JSON:

\`\`\`
✓ Published "report"

  View      ${APP_BASE_URL}/v/art_...
  Expires   2026-06-20
  Upload    3/3 uploaded, 0 reused · 42 KB sent, 0 B cached

  Update    npx @zaks-io/agent-paste publish ./report --artifact-id art_...
            (revises this Artifact; same link live-updates the open page)

  → open ${APP_BASE_URL}/v/art_...
\`\`\`

JSON output has these URL fields:

- \`private_url\` - the one link to hand the user. It is the login-walled
  \`/v/<artifactId>\` clean viewer for the Workspace Member, and the default
  \`View\` link. Publish is content-only and private, so there is no \`shared\`
  field.
- \`revision_content_url\` - exact signed Content Origin URL for this Revision.
  It expires, does not Live Update, and direct HTML opened there is inert raw byte
  delivery rather than the product viewer.
- \`agent_view_url\` - machine-readable Agent View JSON for tools.

The \`make_public\` and \`create_revision_link\` MCP tools return the minted
link as \`url\`.

## Updating published work

Publishing without \`--artifact-id\` creates a new Artifact on a new link. When the
user wants to change something you already published — fix it, update it, extend
it — revise the SAME Artifact instead of publishing a new one:

- CLI: \`npx @zaks-io/agent-paste publish ./path --artifact-id art_...\`
- MCP: \`add_revision\` with the \`artifact_id\`.

The Artifact's View link (and any Share Link) is stable and live-updates pages
already open to the newest Revision, so a revision needs no new link. Re-publishing
an edit as a fresh Artifact strands the link the user already has open. Keep the
\`artifact_id\` from each publish (the CLI \`Update\` hint, the JSON \`artifact_id\`
field, or \`list_artifacts\`) so you can revise.

If the user asks for a public/shareable link, run the separate make-public step:
\`npx @zaks-io/agent-paste make-public <artifact-id>\` on the CLI, or the
\`make_public\` MCP tool. It mints or reuses the Artifact's one Share Link and
returns its public, no-login Access Link Signed URL (as \`url\` on MCP). Publish
itself never makes an Artifact public. Do not return the
\`usercontent.agent-paste.sh/v/...\` Revision Content URL as the final answer.

## Ephemeral publish fallback

Use \`--ephemeral\` only when \`whoami\` reports \`"authenticated": false\` and no
login is available, or when the user explicitly asks for accountless publish. It
ignores stored login credentials and environment-provided credentials, so do not
use it after a successful auth check. It is suitable for
non-interactive work such as text, markdown, images, and static HTML/CSS.

\`\`\`
npx @zaks-io/agent-paste publish ./report --ephemeral
\`\`\`

Ephemeral is not the Free Plan. It is an unclaimed restricted tier with low
write caps, \`noindex\`, a 24 hour lifetime, and script-disabled content serving.
Publish prints a one-time **Claim Token** as a claim link
(\`${APP_BASE_URL}/claim#<token>\`). **Relay the claim link to the user** — not
\`private_url\`. A signed-in human opens that link to view, keep, and reparent
the Artifact into their Workspace. The token rides the URL **hash** only: it never
appears in the query string or in any public Access Link Signed URL. The
\`private_url\` clean viewer works only after claim.

Unclaimed ephemeral HTML is script-disabled. Text, markdown, images, and static
HTML/CSS render, but JavaScript does not run. After claim, newly minted viewer
URLs can run interactive HTML inside the controlled Artifact Viewer. For an
interactive page, browser app, or visualization that needs JavaScript, use
authenticated publish rather than \`--ephemeral\`.

## Authentication

Agents should use either the CLI or MCP.

- **CLI:** \`npx @zaks-io/agent-paste login\` completes a browser OAuth flow and
  stores a scoped local credential for you. Nothing to copy or paste.
- **Ephemeral:** \`npx @zaks-io/agent-paste publish --ephemeral\` is the
  restricted fallback when \`whoami\` reports \`"authenticated": false\` and no
  login is available. The CLI self-provisions a short-lived, low-cap workspace
  and returns a one-time Claim
  Token; a signed-in human redeems it later to keep the Artifact.
- **MCP:** OAuth bearer only. The MCP server verifies a WorkOS-issued access
  token. Product capabilities are derived from the authenticated Workspace
  Member in \`api\`, not from OAuth token scopes.

## MCP server

Base: \`${MCP_BASE_URL}\`

Use MCP when the agent's host can connect to a remote MCP server but cannot run
the CLI, install npm packages, or use a local keychain. MCP tools publish, read,
revise, delete, and share Artifacts through the same Agent View model as the
CLI.

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

- \`publish_artifact\` - publish a NEW text-only Artifact on a new \`private_url\`.
  Content-only and private; it takes no visibility input. Use it only for
  something not yet published; to change published work use \`add_revision\`
  instead. To make it public, call \`make_public\` afterward.
- \`add_revision\` - revise an EXISTING Artifact: add and publish a new Revision
  under its \`artifact_id\`. Use this, not \`publish_artifact\`, to change published
  work — the Artifact's \`private_url\` (and any Share Link) is stable and
  live-updates open viewers, so there is no new link to send. Content-only and
  private; to make it public, call \`make_public\`.
- \`delete_artifact\` - delete an Artifact.
- \`update_display_metadata\` - update an Artifact's display title.

Links (\`share\`):

- \`make_public\` - mint or reuse the Artifact's one Share Link and return its
  public, no-login Access Link Signed URL (also needs \`read\`). This is how an
  Artifact becomes reachable without login, and the link to give users.
- \`create_revision_link\` - create and mint a snapshot Access Link for a
  specific Revision (also needs \`read\`). Use only when the user asked for a
  fixed Revision.
- \`list_access_links\` - list an Artifact's Share Links and Revision Links
  (also needs \`read\`).
- \`revoke_access_link\` - revoke a Share Link or Revision Link.

Limits: MCP publish is text-only today. Use the CLI for folder uploads, binary
files, and standalone Bundle downloads. Use the dashboard for workspace
settings, billing, and lockdown controls. Artifact lifetime follows Workspace
Auto Deletion policy; MCP callers do not choose TTL.

## Where to find more

- Human docs: [https://agent-paste.sh/docs](https://agent-paste.sh/docs)
- Markdown docs: [https://agent-paste.sh/docs.md](https://agent-paste.sh/docs.md)
- Full machine-readable docs: [https://agent-paste.sh/llms-full.txt](https://agent-paste.sh/llms-full.txt)
- Dashboard (humans): [${APP_BASE_URL}](${APP_BASE_URL})
- MCP server: [${MCP_BASE_URL}](${MCP_BASE_URL})
`;
