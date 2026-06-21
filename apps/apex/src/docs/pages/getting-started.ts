import type { DocsPage } from "../types";

export const GETTING_STARTED_DOC: DocsPage = {
  slug: "getting-started",
  title: "Getting Started",
  shortTitle: "Start",
  summary: "Install the CLI, check auth, publish, and hand off your first Artifact.",
  sections: [
    {
      id: "install",
      title: "Install",
      blocks: [
        {
          kind: "paragraph",
          text: "Default to `npx @zaks-io/agent-paste ...` for one-shot Node.js 24+ runs. Use `npm install -g @zaks-io/agent-paste` for repeated npm use. Use the standalone installers only when Node/npm are unavailable. After installation, use the installed `agent-paste ...` command; all paths run the same CLI.",
        },
        {
          kind: "code",
          language: "sh",
          code: "npx @zaks-io/agent-paste publish ./report\nnpm install -g @zaks-io/agent-paste",
        },
        {
          kind: "paragraph",
          text: "Standalone fallback when Node/npm are unavailable:",
        },
        {
          kind: "code",
          language: "sh",
          code: "curl -fsSL https://agent-paste.sh/install.sh | sh",
        },
        {
          kind: "code",
          language: "powershell",
          code: "irm https://agent-paste.sh/install.ps1 | iex",
        },
        {
          kind: "paragraph",
          text: "The installers verify release checksums before placing `agent-paste` on your PATH. The macOS binary is codesigned and notarized.",
        },
      ],
    },
    {
      id: "authenticate",
      title: "Authenticate",
      blocks: [
        {
          kind: "paragraph",
          text: "For interactive use, run `agent-paste login`. It opens a browser OAuth flow and stores a scoped local credential in your OS keyring when available.",
        },
        {
          kind: "code",
          language: "sh",
          code: "agent-paste login\nagent-paste whoami",
        },
        {
          kind: "paragraph",
          text: 'Agents should run `agent-paste whoami --json` before falling back to accountless publish. It exits `0` whether or not you are signed in, so check the JSON rather than the exit code: a signed-in response means use normal authenticated publish, not `--ephemeral`; `"authenticated": false` means no usable credential. If browser auth is possible, run `agent-paste login` before publishing. Use `--ephemeral` only when login is unavailable or explicitly skipped.',
        },
      ],
    },
    {
      id: "publish",
      title: "Publish",
      blocks: [
        {
          kind: "code",
          language: "sh",
          code: "agent-paste publish ./report\nagent-paste publish ./report --artifact-id art_01H...",
        },
        {
          kind: "paragraph",
          text: "A publish walks a file or folder, creates an Upload Session, uploads bytes to signed upload-worker URLs, finalizes a Revision, and publishes it. Publish is content-only and private. CLI publish prints the `private_url` (`/v/<artifactId>` clean viewer) as `View`; MCP publish returns the same `private_url` and omits management IDs. CLI JSON output carries diagnostic IDs and snapshot URLs for automation. Artifact lifetime comes from Workspace policy, not a CLI flag.",
        },
        {
          kind: "paragraph",
          text: "`private_url` is login-walled app navigation. A plain `curl` may receive the web app shell with a sign-in redirect state and HTTP 200; that does not make the Artifact publicly readable. For a no-login browser handoff, use a Share Link from `agent-paste set-visibility <artifact-id> unlisted`.",
        },
        {
          kind: "paragraph",
          text: "A publish path can be a file or directory. Directory publish preserves relative paths, so an HTML entrypoint can load sibling CSS, JS, JSON, images, and fonts. Folder entrypoint inference is exactly `index.html`, `index.md`, `README.md`, then the only file in the folder. If a multi-file folder has none of those, publish fails; pass `--entrypoint <path>`. Folder uploads exclude `.git/`, `node_modules/`, `.DS_Store`, `.env`, and `.env.*`.",
        },
        {
          kind: "paragraph",
          text: 'For an authenticated unlisted no-login link that follows later publishes, run `agent-paste set-visibility <artifact-id> unlisted` on the CLI, or MCP `set_visibility` with `visibility: "unlisted"`, to mint or reuse the Share Link and return `unlisted_url`. Accountless `--ephemeral` publish is the exception: it auto-creates that Share Link and returns `unlisted_url` immediately. The direct `usercontent.agent-paste.sh/v/...` URL points at one Revision, does not Live Update, and direct HTML opened there is inert raw byte delivery. The `private_url` clean viewer is the default Workspace view publish returns.',
        },
      ],
    },
    {
      id: "no-account",
      title: "Ephemeral fallback",
      blocks: [
        {
          kind: "code",
          language: "sh",
          code: "npx @zaks-io/agent-paste publish ./report --ephemeral",
        },
        {
          kind: "paragraph",
          text: "`--ephemeral` self-provisions a short-lived Ephemeral Workspace, publishes once, and leads human output with `unlisted_url`, a working no-login script-disabled Share Link. Relay `unlisted_url` for immediate viewing and `claim_url` when the human wants to keep, own, or unlock interactivity. There is no user-backed session before claim; the signed-in browser session that opens `claim_url` chooses the destination Workspace. If copied instructions include `--claim-code <clm_...>`, preserve it; the API embeds it in the Claim Token for attribution and the CLI never returns it separately. It ignores stored login, so use it only when auth is unavailable or explicitly skipped. Ephemeral is not the Free Plan: use it for non-interactive text, markdown, images, and static HTML/CSS. Unclaimed ephemeral HTML is script-disabled, so use authenticated publish for interactive work.",
        },
      ],
    },
  ],
};
