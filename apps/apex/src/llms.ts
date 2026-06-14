import { APP_BASE_URL, MCP_BASE_URL } from "./copy";

const LLMS_TXT_BASE = `# agent-paste

> Durable, addressable artifacts for AI agents. Publish returns an authenticated
> View URL plus machine-readable diagnostics for follow-up work.

agent-paste gives agents a stable, addressable place to publish work products.
An Artifact is a folder of one or more files. Default publish flows return an
authenticated Artifact URL as View plus an Agent View manifest another agent can
read. Public sharing is explicit: return access_link_url only when the user asks
for a Share Link. Do not send users to the usercontent Revision Content URL as
the final live page.

## What you can do here

- Sign in once with \`npx @zaks-io/agent-paste login\` (browser OAuth, no
  credential to copy), then publish: \`npx @zaks-io/agent-paste publish ./path\`
  prints \`View\`, the authenticated app URL for the Artifact. Retries are
  idempotent.
- Update published work in place. To change something you already published — fix
  it, extend it — add a Revision to the SAME Artifact instead of publishing again:
  \`npx @zaks-io/agent-paste publish ./path --artifact-id art_...\` (CLI, the id is
  in the publish output) or MCP \`add_revision\`. The Artifact's View link (and any
  Share Link) is stable and live-updates pages already open to the newest Revision,
  so a revision needs no new link. Publishing again without the id makes a new
  Artifact on a new link and strands the page the user already has open.
- Before using the accountless path, run \`npx @zaks-io/agent-paste whoami --json\`.
  It exits \`0\` either way; check the JSON, not the exit code. If it shows you are
  signed in, publish normally. If it shows \`"authenticated": false\`, ask the user
  to run \`npx @zaks-io/agent-paste login\` when interactive auth is possible.
- Ephemeral fallback: \`npx @zaks-io/agent-paste publish ./path --ephemeral\`
  ignores stored login and environment-provided credentials. Use it only when no
  auth is available or the user explicitly asks for accountless publish.
  Ephemeral is not the Free Plan: it is
  an unclaimed restricted tier. The Artifact lives 24h and prints a one-time
  claim link (\`${APP_BASE_URL}/claim#<token>\`). **Give the user the claim link,
  not the Artifact URL** — a signed-in human opens it to view, keep, and unlock
  the Artifact. Use it for non-interactive text, markdown, images, and static
  HTML/CSS. Unclaimed ephemeral HTML is script-disabled, so use authenticated
  publish for interactive pages, browser apps, or visualizations that need
  JavaScript.
- Read an artifact from agent-facing surfaces through the CLI, \`${MCP_BASE_URL}\`
  (MCP tool \`read_artifact\`), or the dashboard for humans.
- Share an artifact only when explicitly asked with a revocable Share Link. For a
  public/shareable page, use CLI \`--share\` or MCP \`share:true\`/the link tools,
  then return its minted Access Link Signed URL. A human opens it at
  \`${APP_BASE_URL}/al/{public_id}#...\`. Revoke it without deleting the
  underlying Artifact.
- CLI publish is private by default. Use
  \`npx @zaks-io/agent-paste publish ./path --share\` only when the user
  explicitly asks for a public/shareable link.
- In MCP publish tools, \`share\` defaults to \`false\`. Set \`share:true\` only
  when the user explicitly asks for a public/shareable Access Link, then return
  \`access_link_url\`. Do not return \`usercontent.agent-paste.sh/v/...\` as the
  final live page.

## Entry points

- CLI: \`npx @zaks-io/agent-paste publish <path>\` - primary publish path
- MCP server: ${MCP_BASE_URL}
- Dashboard (humans): ${APP_BASE_URL}

Auth: \`npx @zaks-io/agent-paste login\` signs the CLI in over OAuth and stores
its own local credential. The MCP server is OAuth-only and takes a WorkOS-issued
bearer token.

## Mental model

- Artifact - addressable, named container (folder).
- Revision - immutable saved state. Revise an existing Artifact with
  \`--artifact-id\` (CLI) or \`add_revision\` (MCP); the Artifact's stable link
  follows the latest Revision and live-updates open viewers. A bare publish makes a
  new Artifact on a new link instead.
- Access Link - revocable grant family for unauthenticated read access. Share
  Links and Revision Links are Access Link types; an Access Link Signed URL is
  the minted URL string.
- Artifact URL - authenticated Artifact detail URL for workspace management; not
  the primary user-facing live link.
- Revision Content URL - signed \`usercontent.agent-paste.sh/v/...\` content URL
  for one exact Revision. It expires, does not Live Update, and direct HTML there
  is inert raw byte delivery rather than the product viewer.
- Share Link - Access Link type that follows the latest Published Revision for
  the Artifact Viewer.
- Access Link Signed URL - the URL string minted from an Access Link. Return the
  one minted from a Share Link only when public sharing is explicitly requested.

## Longer agent guide

See /agents.md for the compact agent guide. The complete public docs are
available as human HTML at /docs, a Markdown index at /docs.md, per-page
Markdown twins under /docs/{slug}.md, and one full corpus at /llms-full.txt.
`;

const LLMS_PRICING_SECTION = `
## Pricing

- Public pricing page (Free vs Pro): /pricing
- In-app billing dashboard (Checkout / Portal): ${APP_BASE_URL}/billing
`;

export function renderLlmsTxt(billingEnabled: boolean): string {
  return billingEnabled ? `${LLMS_TXT_BASE}${LLMS_PRICING_SECTION}` : LLMS_TXT_BASE;
}
