import type { DocsPage } from "../types.js";

export const GETTING_STARTED_DOC: DocsPage = {
  slug: "getting-started",
  title: "Getting Started",
  shortTitle: "Start",
  summary: "Install the CLI, sign in or publish ephemerally, and hand off your first Artifact.",
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
          text: "For interactive use, run `agent-paste login`. It opens a browser OAuth flow, mints a scoped API Key, and stores it in your OS keyring when available.",
        },
        {
          kind: "code",
          language: "sh",
          code: "agent-paste login\nagent-paste whoami",
        },
        {
          kind: "paragraph",
          text: "For CI or a headless agent, set `AGENT_PASTE_API_KEY`. The CLI never accepts secrets as flags. If both a stored login and `AGENT_PASTE_API_KEY` exist, the environment key wins.",
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
          code: "agent-paste publish ./report\nagent-paste publish ./report --ttl 7d\nagent-paste publish ./report --artifact-id art_01H...",
        },
        {
          kind: "paragraph",
          text: "A publish walks a file or folder, creates an Upload Session, uploads bytes to signed upload-worker URLs, finalizes a Revision, and returns an Artifact ID plus human and agent URLs.",
        },
        {
          kind: "paragraph",
          text: "A folder entrypoint is inferred from `index.html`, `index.md`, `README.md`, or the only file in the folder. Pass `--entrypoint` when that is not enough.",
        },
      ],
    },
    {
      id: "no-account",
      title: "Publish with no account",
      blocks: [
        {
          kind: "code",
          language: "sh",
          code: "npx @zaks-io/agent-paste publish ./report --ephemeral",
        },
        {
          kind: "paragraph",
          text: "`--ephemeral` self-provisions a short-lived Ephemeral Workspace and key, publishes once, and prints a one-time Claim Token as `/claim#<token>`. A signed-in human opens the claim link to keep the Artifact.",
        },
      ],
    },
  ],
};
