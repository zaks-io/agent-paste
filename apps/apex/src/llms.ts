import { APP_BASE_URL, MCP_BASE_URL } from "./copy";

const LLMS_TXT_BASE = `# agent-paste

> Durable, addressable artifacts for AI agents. Publish is content-only and
> private: it returns a login-walled View URL (private_url) plus machine-readable
> diagnostics for follow-up work.

agent-paste gives agents a stable, addressable place to publish work products.
An Artifact is a folder of one or more files. Publish is content-only and
private: it returns the private_url clean viewer (\`/v/<artifactId>\`) as View
plus an Agent View manifest another agent can read. To make an Artifact reachable
without login, set visibility to \`unlisted\` (\`agent-paste set-visibility
<artifact-id> unlisted\` on the CLI, \`set_visibility\` with
\`visibility: "unlisted"\` on MCP), then return \`unlisted_url\`. Do not send users
to the usercontent Revision Content URL as the final live page.

## What you can do here

- Sign in once with \`npx @zaks-io/agent-paste login\` (browser OAuth, no
  credential to copy), then publish: \`npx @zaks-io/agent-paste publish ./path\`
  prints \`View\`, the \`private_url\` clean viewer (\`/v/<artifactId>\`) for the
  Artifact. Retries are idempotent.
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
  an unclaimed restricted tier. The Artifact lives 24h and returns
  \`unlisted_url\`, a no-login script-disabled Share Link that works immediately,
  plus \`claim_url\` (\`${APP_BASE_URL}/claim#<token>\`) for keeping and unlocking
  the Artifact. **Give the user \`unlisted_url\` for viewing, not the
  \`private_url\`**. Use it for non-interactive text, markdown, images, and static
  HTML/CSS. Unclaimed ephemeral HTML is script-disabled, so use authenticated
  publish for interactive pages, browser apps, or visualizations that need
  JavaScript.
- If the user's prompt includes \`--claim-code <clm_...>\`, preserve that exact
  flag on \`publish --ephemeral\`. A Claim Code is public attribution for the
  claim funnel, not auth, ownership, billing, idempotency, a Claim Token, or a
  secret. The CLI copies it into \`unlisted_url\` and \`claim_url\` as
  \`?claim_code=<clm_...>\`; the bearer secrets stay in URL hashes.
- Read an artifact from agent-facing surfaces through the CLI, \`${MCP_BASE_URL}\`
  (MCP tool \`read_artifact\`), or the dashboard for humans.
- Verification: \`private_url\` is login-walled app navigation; a plain HTTP 200
  can be only the app shell or sign-in state. For no-login verification, use a
  Share Link from \`set-visibility <artifact-id> unlisted\`. For machine
  verification, fetch \`agent_view_url\` and read signed per-file URLs from
  \`files[].url\`.
- Share an artifact only when explicitly asked, through the separate visibility
  step: \`npx @zaks-io/agent-paste set-visibility <artifact-id> unlisted\` on the
  CLI, or MCP \`set_visibility\` with \`visibility: "unlisted"\`. It mints or
  reuses the one revocable Share Link and returns \`unlisted_url\`. A human opens
  it at \`${APP_BASE_URL}/al/{public_id}#...\`. Revoke it without deleting the
  underlying Artifact.
- Authenticated publish is content-only and private; there is no \`--share\`
  flag and no \`share\` input. Run the unlisted visibility step only when the user
  explicitly asks for a shareable no-login link, then return \`unlisted_url\`.
  Accountless \`--ephemeral\` publish is the exception: it auto-creates
  \`unlisted_url\`. Do not return \`usercontent.agent-paste.sh/v/...\` as the
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
- Private Link - login-walled clean viewer (\`/v/<artifactId>\`) for a Workspace
  Member, returned by publish as \`private_url\` and the default user-facing View.
- Artifact Console - dashboard-only management page (\`/artifacts/<id>\`); never
  returned by publish or any agent surface.
- Revision Content URL - signed \`usercontent.agent-paste.sh/v/...\` content URL
  for one exact Revision. It expires, does not Live Update, and direct HTML there
  is inert raw byte delivery rather than the product viewer.
- Share Link - Access Link type that follows the latest Published Revision for
  the Artifact Viewer. Created only by setting visibility to \`unlisted\`, never
  by publish.
- Access Link Signed URL - the URL string minted from an Access Link. The one
  minted from a Share Link is the unlisted no-login link returned as
  \`unlisted_url\`.
- Claim Code - optional \`clm_...\` analytics attribution from copied prompts.
  Preserve it when present on \`publish --ephemeral\`; it is safe to appear in the
  public \`claim_code\` query parameter and is not the Claim Token.

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
