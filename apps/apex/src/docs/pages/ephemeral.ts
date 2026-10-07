import type { DocsPage } from "../types";

export const EPHEMERAL_DOC: DocsPage = {
  slug: "ephemeral",
  title: "Ephemeral Publish",
  shortTitle: "Ephemeral",
  summary: "Accountless 24-hour static publishing.",
  sections: [
    {
      id: "when",
      title: "When to use it",
      blocks: [
        {
          kind: "paragraph",
          text: "Check `whoami --json` first. An injected `AGENT_PASTE_API_KEY` or saved credential needs no login. Without a usable credential, a sandbox can use an API key or `login --device-code`. Use `--ephemeral` when no authenticated path is available and static output meets the task, or the user asks for accountless publishing. It explicitly ignores both environment and saved credentials. Do not switch to it automatically after an authentication failure. See [CLI authentication](/docs/cli#api-keys).",
        },
        {
          kind: "paragraph",
          text: "Ephemeral Artifacts live in an unclaimed Workspace with low write caps, delete after 24 hours, and are `noindex`. They serve static content: scripts, fetch, forms, frames, objects, and workers are blocked.",
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
          code: "agent-paste publish ./report --ephemeral --json",
        },
        {
          kind: "paragraph",
          text: "Return `url`. Also return `claim_url` if the user wants to keep the Artifact.",
        },
      ],
    },
    {
      id: "claim",
      title: "Claim",
      blocks: [
        {
          kind: "paragraph",
          text: "The Claim Token lives only in the `claim_url` hash, never in the Artifact URL or a query string. Redeeming it in a signed-in browser moves the Artifact into that member's Workspace, keeps the URL, and lifts the script and network blocks.",
        },
      ],
    },
  ],
};
