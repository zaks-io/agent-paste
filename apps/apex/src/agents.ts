// Source for the public /agents.md guide.
//
// Treat this as product documentation for agents using Agent Paste, not as repo
// documentation and not as an eval prompt. Every served word should help an
// agent choose CLI vs MCP, publish an Artifact, understand the returned links,
// or find public product docs.
//
// Do not put internal setup notes, deployment details, repo workflow guidance,
// eval harness hints, generic agent behavior coaching, or brittle prompt/copy
// test expectations here.
import { API_BASE_URL, APP_BASE_URL, MCP_BASE_URL } from "./copy";

export const AGENTS_MD = `# agent-paste for agents

Agent Paste turns agent-made files or directories into links. Use it when the
next step should be a URL, not a deploy, zip, gist, screenshot, or "run this
locally."

Authenticated publish creates a private Workspace view first. To send a
no-login browser link, either make that Artifact unlisted with
\`set-visibility\` or use \`--ephemeral\` when there is no login.

Default to the CLI. Use MCP only when the host can connect to remote MCP but
cannot run shell commands.

## When This Saves Time

Use Agent Paste for:

- Reports, prototypes, dashboards, logs, images, Markdown files, or static
  sites.
- Remote-agent output that should open on any device without a repo, local
  server, or deploy project.
- Iterating on one Artifact while its viewer link stays stable.
- Hosted agents that can use MCP but cannot run shell commands.

## Choose A Surface

1. **CLI available:** use \`npx @zaks-io/agent-paste\`.
2. **No CLI, remote MCP available:** connect \`${MCP_BASE_URL}\`.
3. **Protocol client implementation:** fetch auth metadata at \`${API_BASE_URL}/auth.md\`.
4. **Human dashboard:** send humans to \`${APP_BASE_URL}\`.

## Install

Default: use \`npx\` with Node.js 24+. No global install is required.

\`\`\`sh
npx @zaks-io/agent-paste publish ./path --json
\`\`\`

For repeated npm use, install the package globally:

\`\`\`sh
npm install -g @zaks-io/agent-paste
agent-paste publish ./path --json
\`\`\`

Fallback only when Node/npm are unavailable: use a standalone installer. The
installers verify release checksums before placing \`agent-paste\` on PATH.

\`\`\`sh
curl -fsSL https://agent-paste.sh/install.sh | sh
\`\`\`

\`\`\`powershell
irm https://agent-paste.sh/install.ps1 | iex
\`\`\`

The npm package is \`@zaks-io/agent-paste\`. The installed command is
\`agent-paste\`.

## CLI Flow

Check auth first:

\`\`\`sh
npx @zaks-io/agent-paste whoami --json
\`\`\`

\`whoami\` exits 0 when signed out; read \`authenticated\`. If false and the user
can interact, run:

\`\`\`sh
npx @zaks-io/agent-paste login
\`\`\`

Login is OAuth and opens a browser window for the user.

If browser login cannot be completed, use the anonymous ephemeral flow below
instead of retrying login.

Signed-in publish:

\`\`\`sh
npx @zaks-io/agent-paste publish ./path --json
\`\`\`

This uploads to the user's Workspace. Save \`artifact_id\` if you may update the
Artifact or create an unlisted link later.

\`./path\` may be a file or directory. Directory publish preserves relative
paths, so \`index.html\` can load sibling CSS, JS, JSON, images, and fonts.
Entrypoint inference is: \`index.html\`, \`index.md\`, \`README.md\`, then the
only file in the directory. If a multi-file directory has none of those, publish
fails; pass \`--entrypoint <path>\`. Folder uploads exclude \`.git/\`,
\`node_modules/\`, \`.DS_Store\`, \`.env\`, and \`.env.*\`.

No-login link after authenticated publish:

\`\`\`sh
npx @zaks-io/agent-paste set-visibility <artifact_id> unlisted --json
\`\`\`

Update work you already published:

\`\`\`sh
npx @zaks-io/agent-paste publish ./path --artifact-id <artifact_id> --json
\`\`\`

Publishing with \`--artifact-id\` keeps existing viewer links stable.

Anonymous 24h upload:

\`\`\`sh
npx @zaks-io/agent-paste publish ./path --ephemeral --json
npx @zaks-io/agent-paste publish ./path --ephemeral --claim-code <clm_...> --json
\`\`\`

Use \`--ephemeral\` when no login/account is available, or when the user
explicitly asks for accountless publish. It ignores stored login and configured
credentials.

\`claim_url\` lets a signed-in human keep the 24h upload in a Workspace.

Unclaimed ephemeral uploads expire in 24h and serve HTML with scripts disabled.
Use static HTML/CSS. Do not make the page depend on client-side JavaScript,
module scripts, or CDN scripts before claim. Pre-claim credentials stop working
after claim.

If copied instructions include \`--claim-code <clm_...>\`, preserve it on the
\`publish --ephemeral\` command. Agent Paste uses it for attribution.

## Reading URLs

\`agent_view_url\` is the machine-readable manifest for agents. Per-file signed
URLs are \`files[].url\`. \`revision_content_url\` is raw signed bytes for one
Revision; it expires and does not Live Update.

## Object Model

- **Artifact:** named container for files, identified by \`art_...\`.
- **Revision:** immutable saved state. Use \`--artifact-id\` or MCP
  \`add_revision\` to add a new Revision to an existing Artifact.
- **Share Link:** revocable no-login link returned as \`unlisted_url\`.
- **Claim Token:** one-time token inside the ephemeral \`claim_url\`; the
  signed-in browser session that redeems it chooses the destination Workspace.
- **Claim Code:** optional \`clm_...\` attribution from copied prompts.

## MCP

Base: \`${MCP_BASE_URL}\`

Use MCP when the host supports remote MCP but cannot run the CLI. MCP is
OAuth-only. Connect the server, complete OAuth, then call \`whoami\`.

Tool choice:

- Check auth: \`whoami\`
- List/read: \`list_artifacts\`, \`read_artifact\`, \`read_file\`,
  \`list_revisions\`
- Create: \`publish_artifact\` for a new text-only Artifact
- Revise: \`add_revision\` or \`multi_edit\` for an existing Artifact
- Share: \`set_visibility\` with \`visibility: "unlisted"\`
- Make private: \`set_visibility\` with \`visibility: "private"\`
- Snapshot link: \`create_revision_link\`
- Manage links: \`list_access_links\`, \`revoke_access_link\`
- Delete/update metadata: \`delete_artifact\`, \`update_display_metadata\`

MCP publish tools are text-only today. Use the CLI for folders and binary
uploads. Ready Bundle URLs are exposed through Agent View/read tools. Use the
dashboard for settings, billing, and lockdown controls.

## More

- Human docs: [https://agent-paste.sh/docs](https://agent-paste.sh/docs)
- Markdown docs: [https://agent-paste.sh/docs.md](https://agent-paste.sh/docs.md)
- Safety docs: [https://agent-paste.sh/docs/safety.md](https://agent-paste.sh/docs/safety.md)
- Full corpus: [https://agent-paste.sh/llms-full.txt](https://agent-paste.sh/llms-full.txt)
`;
