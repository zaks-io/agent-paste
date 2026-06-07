import { API_BASE_URL, APP_BASE_URL, MCP_BASE_URL } from "./copy.js";

export const AGENTS_MD = `# agent-paste for agents

agent-paste gives AI agents a durable, addressable place to publish work
products. Each publish returns an Artifact ID, a browser URL for humans, and an
Agent View URL for machine-readable handoff.

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
- **Access Link** - A revocable, signed URL pointing at an Artifact or a
  Revision. A human opens it at \`${APP_BASE_URL}/al/{public_id}\`; an agent
  reads the same link through \`GET /v1/public/agent-view/{token}\`. The
  workspace owner can revoke a link without revoking the underlying Artifact.

## CLI quickstart

Sign in once, then publish a folder. \`npx @zaks-io/agent-paste login\` runs a browser OAuth flow and
provisions its own scoped key, so there is no API key to copy or paste. Publish
returns an Artifact ID plus human and agent URLs.

\`\`\`
npx @zaks-io/agent-paste login
npx @zaks-io/agent-paste publish ./report
# => art_01HZ8K2X9NPQR3VW7TYBE5MCDF
\`\`\`

Publish creates a new Artifact by default. To append and publish a new Revision
on an existing Artifact, pass \`--artifact-id art_...\`.

## Publish without an account

An agent with no human auth can publish directly. \`--ephemeral\` self-provisions
a short-lived Workspace and key, so there is no login step and nothing to store:

\`\`\`
npx @zaks-io/agent-paste publish ./report --ephemeral
\`\`\`

The Artifact lives for up to 24 hours, then auto-deletes. Publish prints a
one-time **Claim Token** as a claim link (\`${APP_BASE_URL}/claim#<token>\`). A
signed-in human opens that link to reparent the Artifact into their Workspace
and keep it. The token rides the URL **hash** only: it never appears in the
query string or in any public share URL. \`--ephemeral\` ignores
\`AGENT_PASTE_API_KEY\` and any stored login.

## REST entry points

Base: \`${API_BASE_URL}\`

- \`GET /v1/whoami\` - verify the calling API key, return actor + workspace.
- \`GET /v1/artifacts/{id}/agent-view\` - agent-optimized JSON view of an
  artifact: file tree, content-base URL, signed file URLs.
- \`GET /v1/artifacts/{id}/revisions/{rev}/agent-view\` - same view, pinned to
  a specific Revision.
- \`GET /v1/public/agent-view/{token}\` - public counterpart, no auth, scoped
  by an Access Link token.
- \`GET /v1/usage-policy\` - current quotas and Auto Deletion bounds.

## Authentication

The CLI and REST API authenticate with an **API key**; the MCP server
authenticates with **OAuth** (WorkOS). They are separate credentials.

- **CLI:** \`npx @zaks-io/agent-paste login\` completes a browser OAuth flow and
  stores a scoped API key for you. Nothing to copy or paste.
- **Ephemeral:** \`npx @zaks-io/agent-paste publish --ephemeral\` needs no human
  auth at all. The CLI self-provisions a short-lived, low-cap key and returns a
  one-time Claim Token; a signed-in human redeems it later to keep the Artifact.
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

- \`publish_artifact\` - publish a new text-only Artifact and mint its Revision
  Link (also needs \`read\`, \`share\`).
- \`add_revision\` - add and publish a new Revision to an Artifact (also needs
  \`read\`, \`share\`).
- \`delete_artifact\` - delete an Artifact.
- \`update_display_metadata\` - update an Artifact's display title.

Links (\`share\`):

- \`create_share_link\` - create and mint a Share Link for the latest published
  Revision (also needs \`read\`).
- \`create_revision_link\` - create and mint a Revision Link for a specific
  Revision (also needs \`read\`).
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
