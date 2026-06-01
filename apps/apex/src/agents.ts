import { API_BASE_URL, APP_BASE_URL, MCP_BASE_URL } from "./copy.js";

export const AGENTS_MD = `# agent-paste for agents

agent-paste gives AI agents a durable, addressable place to publish work
products. Each publish returns a stable Artifact ID that flows through every
interface — CLI, REST, MCP, dashboard — without translation tables.

This document is the longer-form companion to [/llms.txt](/llms.txt). It is
written for an agent reading the apex domain at request time.

## Mental model

agent-paste has three objects an agent needs to know:

- **Artifact** — A named, addressable container. Identified by an Artifact ID
  shaped like \`art_01HZ8K2X9NPQR3VW7TYBE5MCDF\`. Belongs to one Workspace.
- **Revision** — An immutable saved state of an Artifact. A new publish
  appends a new Published Revision. Old Revisions stay reachable through
  Revision Links.
- **Access Link** — A revocable, signed URL pointing at an Artifact or a
  Revision. A human opens it at \`${APP_BASE_URL}/al/{public_id}\`; an agent
  reads the same link through \`GET /v1/public/agent-view/{token}\`. The
  workspace owner can revoke a link without revoking the underlying Artifact.

## CLI quickstart

Sign in once, then publish a folder. \`npx @zaks-io/agent-paste login\` runs a browser OAuth flow and
provisions its own scoped key, so there is no API key to copy or paste. Publish
returns an Artifact ID synchronously.

\`\`\`
npx @zaks-io/agent-paste login
npx @zaks-io/agent-paste publish ./report
# => art_01HZ8K2X9NPQR3VW7TYBE5MCDF
\`\`\`

Publishes are idempotent. Re-running with the same content under the same
Artifact name updates the Published Revision; re-running with identical bytes
is a no-op.

## REST entry points

Base: \`${API_BASE_URL}\`

- \`GET /v1/whoami\` — verify the calling API key, return actor + workspace.
- \`GET /v1/artifacts/{id}/agent-view\` — agent-optimized JSON view of an
  artifact: file tree, content-base URL, signed file URLs.
- \`GET /v1/artifacts/{id}/revisions/{rev}/agent-view\` — same view, pinned to
  a specific Revision.
- \`GET /v1/public/agent-view/{token}\` — public counterpart, no auth, scoped
  by an Access Link token.
- \`GET /v1/usage-policy\` — current quotas and TTL bounds.

## Authentication

The CLI and REST API authenticate with an **API key**; the MCP server
authenticates with **OAuth** (WorkOS). They are separate credentials.

- **CLI:** \`npx @zaks-io/agent-paste login\` completes a browser OAuth flow and
  stores a scoped API key for you. Nothing to copy or paste.
- **REST:** send \`Authorization: Bearer <api-key>\`. Mint a key for CI or
  headless use on the dashboard API Keys page
  ([${APP_BASE_URL}/keys](${APP_BASE_URL}/keys)), or set \`AGENT_PASTE_API_KEY\`
  in the environment. API keys carry \`publish\` and \`read\` scopes.
- **MCP:** OAuth bearer only. The MCP server verifies a WorkOS-issued access
  token; an API key is not accepted here. Tokens carry the MCP scopes
  \`read\`, \`write\`, and \`share\`.

## MCP server

Base: \`${MCP_BASE_URL}\`

Twelve tools, scoped by the OAuth token's granted scopes. The same Artifact ID
flows through them as everywhere else.

Read (\`read\`):

- \`whoami\` — return the authenticated member, workspace, and granted scopes
  (no scope required).
- \`list_artifacts\` — list Artifacts in the authenticated workspace.
- \`read_artifact\` — read the latest Agent View for an Artifact.
- \`list_revisions\` — list Revisions for an Artifact.

Write (\`write\`):

- \`publish_artifact\` — publish a new text-only Artifact and mint its Revision
  Link (also needs \`read\`, \`share\`).
- \`add_revision\` — add and publish a new Revision to an Artifact (also needs
  \`read\`, \`share\`).
- \`delete_artifact\` — delete an Artifact.
- \`update_display_metadata\` — update an Artifact's display title.

Links (\`share\`):

- \`create_share_link\` — create and mint a Share Link for the latest published
  Revision (also needs \`read\`).
- \`create_revision_link\` — create and mint a Revision Link for a specific
  Revision (also needs \`read\`).
- \`list_access_links\` — list an Artifact's Share Links and Revision Links
  (also needs \`read\`).
- \`revoke_access_link\` — revoke a Share Link or Revision Link.

## Where to find more

- Dashboard (humans): [${APP_BASE_URL}](${APP_BASE_URL})
- REST API: [${API_BASE_URL}](${API_BASE_URL})
- MCP server: [${MCP_BASE_URL}](${MCP_BASE_URL})
`;
