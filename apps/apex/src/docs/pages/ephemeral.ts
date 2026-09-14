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
          text: "Check `whoami --json` first; a sandbox can usually still sign in with `login --device-code`. Use `--ephemeral` when login is unavailable or the user asks for accountless publishing.",
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
