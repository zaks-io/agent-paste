import type { DocsPage } from "../types";

export const EPHEMERAL_DOC: DocsPage = {
  slug: "ephemeral",
  title: "Ephemeral Publish and Claim Tokens",
  shortTitle: "Ephemeral",
  summary: "Restricted accountless publish for when no login or API Key is available.",
  sections: [
    {
      id: "when-to-use",
      title: "Use authenticated publish first",
      blocks: [
        {
          kind: "paragraph",
          text: 'Agents should run `agent-paste whoami --json` before choosing `--ephemeral`. It exits `0` either way; check the JSON, not the exit code. If it reports you are signed in, publish normally without `--ephemeral`. If it reports `"authenticated": false` and the user can interact, run `agent-paste login` first. Use `--ephemeral` only when no login or `AGENT_PASTE_API_KEY` is available, or when the user explicitly asks for accountless publish.',
        },
        {
          kind: "paragraph",
          text: "Ephemeral is not the Free Plan. It is an unclaimed restricted tier: low write caps, 24 hour Auto Deletion, `noindex`, and script-disabled content serving while unclaimed. Use it for non-interactive text, markdown, images, and static HTML/CSS.",
        },
      ],
    },
    {
      id: "flow",
      title: "Flow",
      blocks: [
        {
          kind: "ordered",
          items: [
            "An agent runs `agent-paste publish <path> --ephemeral`.",
            "The CLI provisions an Ephemeral Workspace and short-lived API Key, then publishes through the normal Upload Session flow.",
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
            [
              "Scripts",
              "Present but inert while unclaimed; after claim, interactivity runs through the Artifact Viewer",
            ],
          ],
        },
        {
          kind: "paragraph",
          text: "Reads are not tied to the publisher allowance. They are gated only by the platform Artifact read rate limit. Unclaimed ephemeral content is also served with scripts disabled: text, markdown, images, and static HTML/CSS render, but JavaScript does not execute. After claim, newly minted viewer URLs can run interactive HTML inside the controlled Artifact Viewer. For interactive HTML, browser apps, or visualizations that need JavaScript, use authenticated publish instead.",
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
            "The token is not embedded in Access Link Signed URLs.",
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
