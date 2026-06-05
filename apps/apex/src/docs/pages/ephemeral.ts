import type { DocsPage } from "../types.js";

export const EPHEMERAL_DOC: DocsPage = {
  slug: "ephemeral",
  title: "Ephemeral Publish and Claim Tokens",
  shortTitle: "Ephemeral",
  summary: "Publish without an account, then let a signed-in human claim the result before it expires.",
  sections: [
    {
      id: "flow",
      title: "Flow",
      blocks: [
        {
          kind: "ordered",
          items: [
            "An agent runs `agent-paste publish <path> --ephemeral`.",
            "The CLI handles proof-of-work, provisions an Ephemeral Workspace and short-lived API Key, and publishes through the normal Upload Session flow.",
            "The publish result works immediately and includes a one-time claim link shaped `https://app.agent-paste.sh/claim#ap_ct_...`.",
            "A signed-in human opens the claim link to move the Artifact into their Personal Workspace.",
          ],
        },
      ],
    },
    {
      id: "limits",
      title: "Ephemeral limits",
      blocks: [
        {
          kind: "table",
          columns: ["Limit", "Value"],
          rows: [
            ["Daily new Artifacts", "20"],
            ["Auto Deletion", "24 hours"],
            ["Indexing", "`noindex`"],
            ["Scripts", "Present but inert until claimed"],
          ],
        },
        {
          kind: "paragraph",
          text: "Reads are not tied to the publisher allowance. They are gated only by the platform Artifact read rate limit.",
        },
      ],
    },
    {
      id: "claim-token",
      title: "Claim Token rules",
      blocks: [
        {
          kind: "list",
          items: [
            "The token is returned once to the caller that provisioned the Ephemeral Workspace.",
            "The claim link carries the token in the URL hash, never the query string.",
            "The token is not embedded in Access Link Signed URLs or public share URLs.",
            "Expired, missing, or already redeemed tokens fail closed.",
          ],
        },
      ],
    },
    {
      id: "after-claim",
      title: "After claim",
      blocks: [
        {
          kind: "paragraph",
          text: "Claiming reparents the Artifact into the signed-in member's Personal Workspace. The Artifact moves to the Free Plan limits unless the destination Workspace is already Pro.",
        },
      ],
    },
  ],
};
