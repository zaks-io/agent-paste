// Public /agents.md source. Keep this focused on using the shipped product.
import { API_BASE_URL, APP_BASE_URL, MCP_BASE_URL, SKILL_INSTALL_CMD } from "./copy";

export const AGENTS_MD = `# agent-paste for agents

agent-paste publishes a file or directory as a website and returns one URL that
opens without login. Use it when the next step should be a link instead of a
deploy, zip, screenshot, or local server.

Default to the CLI. Use MCP only when the host cannot run commands.

## Skill

\`\`\`sh
${SKILL_INSTALL_CMD}
\`\`\`

## CLI

\`\`\`sh
npx @zaks-io/agent-paste whoami --json
\`\`\`

\`whoami\` exits 0 even when signed out, so check \`authenticated\`. If it is
false, run \`login\` where a browser is available or \`login --device-code\` in a
sandbox. Device login prints a URL and code on stderr; keep it running until the
user approves, then run \`whoami\` again. An \`AGENT_PASTE_API_KEY\` env var also
authenticates and takes precedence over stored credentials.

Publish:

\`\`\`sh
npx @zaks-io/agent-paste publish ./path --json
\`\`\`

Return \`url\` to the user.

Revise at the same URL:

\`\`\`sh
npx @zaks-io/agent-paste publish ./path --artifact-id 01234-56789-abcde-fghjd --json
\`\`\`

The artifact ID is the first label of the URL hostname. \`--artifact-id\`,
\`pull\`, and \`edit\` accept that ID, the \`art_...\` \`artifact_id\` from JSON
output, or the full URL.

When login is unavailable, or the user asks for accountless publishing:

\`\`\`sh
npx @zaks-io/agent-paste publish ./path --ephemeral --json
\`\`\`

Return \`url\`. Also return \`claim_url\` if the user wants to keep the Artifact.
Unclaimed ephemeral Artifacts expire in 24 hours and serve static HTML only:
scripts, fetch, forms, frames, and workers are blocked. Claiming keeps the URL
and lifts those blocks. If the instructions you were given include
\`--claim-code <clm_...>\`, keep it on the command.

Directory publish keeps relative paths and skips \`.git\`, \`node_modules\`,
\`.DS_Store\`, and \`.env*\`. The entrypoint is \`index.html\`, \`index.md\`,
\`README.md\`, or the only file; otherwise pass \`--entrypoint <path>\`.

## Result

\`\`\`json
{
  "schema_version": "2",
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "title": "report",
  "url": "https://01234-56789-abcde-fghjd.agent-paste.link/",
  "expires_at": "<ISO 8601 expiration timestamp>"
}
\`\`\`

Claimed Artifacts run as ordinary top-level pages: inline scripts, external
HTTPS dependencies, fetch, WebSockets, and dedicated workers all work. Service
workers are blocked everywhere.

## MCP

Connect to \`${MCP_BASE_URL}\` with OAuth and call \`whoami\`.

- Create: \`publish_artifact\`
- Revise: \`add_revision\` (whole file) or \`multi_edit\` (literal find/replace)
- Read: \`list_artifacts\`, \`read_artifact\`, \`read_file\`, \`list_revisions\`
- Manage: \`delete_artifact\`, \`update_display_metadata\`

MCP publishes text only; folders and binary files need the CLI. \`artifact_id\`
accepts the ID or the full URL.

## Reading this site

Every page answers \`Accept: text/markdown\` and has a \`.md\` twin: /index.md,
/docs.md, /docs/{slug}.md, /about.md, /how-it-works.md, /terms.md, /privacy.md.

## Links

- Dashboard: ${APP_BASE_URL}
- API auth metadata: ${API_BASE_URL}/auth.md
- Docs: https://agent-paste.sh/docs.md
- Full corpus: https://agent-paste.sh/llms-full.txt
`;
