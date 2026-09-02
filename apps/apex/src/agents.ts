// Public /agents.md source. Keep this focused on using the shipped product.
import { API_BASE_URL, APP_BASE_URL, MCP_BASE_URL, SKILL_INSTALL_CMD } from "./copy";

export const AGENTS_MD = `# agent-paste for agents

Agent Paste turns a file or directory into a top-level website. Use it when the
next step should be a URL instead of a deploy, repository, zip, screenshot, or
local server.

Every publish returns one no-login \`url\` on the Artifact's own capability
subdomain. There is no iframe, viewer wrapper, or second sharing step. Revising
the same Artifact keeps the URL.

Default to the CLI. Use MCP only when the host can connect to remote MCP but
cannot run commands.

## Install the skill

\`\`\`sh
${SKILL_INSTALL_CMD}
\`\`\`

## CLI

Check authentication first:

\`\`\`sh
npx @zaks-io/agent-paste whoami --json
\`\`\`

\`whoami\` exits 0 when signed out, so inspect \`authenticated\`. If it is false
and browser login is possible:

\`\`\`sh
npx @zaks-io/agent-paste login
\`\`\`

Publish a file or directory:

\`\`\`sh
npx @zaks-io/agent-paste publish ./path --json
\`\`\`

Return \`url\` to the user. Save \`artifact_id\` if the agent may revise it.

Revise the Artifact at the same URL:

\`\`\`sh
npx @zaks-io/agent-paste publish ./path --artifact-id <artifact_id> --json
\`\`\`

If login is unavailable, or the user explicitly asks for accountless publish:

\`\`\`sh
npx @zaks-io/agent-paste publish ./path --ephemeral --json
\`\`\`

Return \`url\`. Return \`claim_url\` too when the human wants to keep and own the
upload. Unclaimed ephemeral Artifacts expire after 24 hours and render with
scripts, connections, forms, frames, objects, and workers blocked. Claiming
promotes the same Artifact URL to the claimed execution policy.

If copied instructions include \`--claim-code <clm_...>\`, preserve it on the
ephemeral publish command. It is attribution, not part of the Artifact URL.

Directory publish preserves relative paths. Entrypoint inference is
\`index.html\`, \`index.md\`, \`README.md\`, then the only file. Otherwise pass
\`--entrypoint <path>\`. Folder publishing excludes \`.git/\`, \`node_modules/\`,
\`.DS_Store\`, \`.env\`, and \`.env.*\`.

## Result

\`\`\`json
{
  "schema_version": "2",
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "title": "report",
  "url": "https://0123456789abcdef0123456789abcdef.agent-paste.link/",
  "expires_at": "<ISO 8601 expiration timestamp>"
}
\`\`\`

The URL is an unguessable 128-bit bearer locator. It opens without login and
serves the latest Published Revision. Authenticated publishes can use inline
scripts, external HTTPS dependencies, root-relative assets, fetch, secure
WebSockets, and dedicated workers. Service workers are blocked on every
Artifact host.

## MCP

Connect to \`${MCP_BASE_URL}\`, complete OAuth, and call \`whoami\`.

- Create: \`publish_artifact\`
- Revise: \`add_revision\` or \`multi_edit\`
- Read: \`list_artifacts\`, \`read_artifact\`, \`read_file\`, \`list_revisions\`
- Manage: \`delete_artifact\`, \`update_display_metadata\`

MCP text publish and CLI folder publish return the same \`url\` contract.

## Links

- Dashboard: ${APP_BASE_URL}
- API auth metadata: ${API_BASE_URL}/auth.md
- Human docs: https://agent-paste.sh/docs
- Markdown docs: https://agent-paste.sh/docs.md
- Full corpus: https://agent-paste.sh/llms-full.txt
`;
