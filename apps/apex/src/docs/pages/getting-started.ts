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
          text: "Use `npx` when Node.js 24 is available, or install the standalone binary when you want one file with no Node runtime.",
        },
        {
          kind: "code",
          language: "sh",
          code: "npx @zaks-io/agent-paste publish ./report\ncurl -fsSL https://agent-paste.sh/install.sh | sh",
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
          text: 'Agents should run `agent-paste whoami --json` before falling back to accountless publish. It exits `0` whether or not you are signed in, so check the JSON rather than the exit code: a signed-in response means use normal authenticated publish, not `--ephemeral`; `"authenticated": false` means no usable credential.',
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
          text: "A folder entrypoint is inferred from `index.html`, `index.md`, `README.md`, or the only file in the folder. Pass `--entrypoint` when that is not enough.",
        },
        {
          kind: "paragraph",
          text: "For a public/shareable link that follows later publishes, run the separate make-public step — `agent-paste make-public <artifact-id>` on the CLI, or the `make_public` MCP tool — to mint or reuse the public Share Link. Publish itself never makes an Artifact public. The direct `usercontent.agent-paste.sh/v/...` URL points at one Revision, does not Live Update, and direct HTML opened there is inert raw byte delivery. The `private_url` clean viewer is the default Workspace view publish returns.",
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
          text: "`--ephemeral` self-provisions a short-lived Ephemeral Workspace, publishes once, and leads human output with a one-time Claim Token as `/claim#<token>`. Relay that claim link to the user, not the `private_url`. It ignores stored login, so use it only when auth is unavailable or explicitly skipped. Ephemeral is not the Free Plan: use it for non-interactive text, markdown, images, and static HTML/CSS. Unclaimed ephemeral HTML is script-disabled, so use authenticated publish for interactive work.",
        },
      ],
    },
  ],
};
