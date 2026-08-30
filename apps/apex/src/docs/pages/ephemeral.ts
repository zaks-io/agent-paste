import type { DocsPage } from "../types";

export const EPHEMERAL_DOC: DocsPage = {
  slug: "ephemeral",
  title: "Ephemeral Publish",
  shortTitle: "Ephemeral",
  summary: "Accountless 24-hour publishing when interactive login is unavailable.",
  sections: [
    {
      id: "when",
      title: "When to use it",
      blocks: [
        {
          kind: "paragraph",
          text: "Run `whoami --json` first. Use `--ephemeral` only when login is unavailable or the user explicitly requests accountless publishing.",
        },
        {
          kind: "paragraph",
          text: "Ephemeral is an unclaimed Workspace with low write caps, 24-hour Auto Deletion, and `noindex`. Its Artifact URL uses the same script-enabled top-level rendering behavior as authenticated publish.",
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
          text: "Return `url` for immediate viewing. Return `claim_url` too when the human wants to keep and own the Artifact.",
        },
      ],
    },
    {
      id: "claim",
      title: "Claim",
      blocks: [
        {
          kind: "paragraph",
          text: "The Claim Token lives only in the `claim_url` hash. It is never placed in the Artifact URL or a query string. The signed-in browser session that redeems it selects the destination Workspace.",
        },
      ],
    },
  ],
};
