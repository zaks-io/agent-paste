import type { DocsPage } from "../types";

export const EPHEMERAL_DOC: DocsPage = {
  slug: "ephemeral",
  title: "Ephemeral Publish and Claim Tokens",
  shortTitle: "Ephemeral",
  summary: "Restricted accountless publish for when no login is available.",
  sections: [
    {
      id: "when-to-use",
      title: "Use authenticated publish first",
      blocks: [
        {
          kind: "paragraph",
          text: 'Agents should run `agent-paste whoami --json` before choosing `--ephemeral`. It exits `0` either way; check the JSON, not the exit code. If it reports you are signed in, publish normally without `--ephemeral`. If it reports `"authenticated": false` and the user can interact, run `agent-paste login` first. Use `--ephemeral` only when no login is available, or when the user explicitly asks for accountless publish.',
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
            "If copied instructions include `--claim-code <clm_...>`, the agent preserves it on the publish command.",
            "The CLI provisions an Ephemeral Workspace, then publishes through the normal Upload Session flow.",
            "Human-readable output leads with `unlisted_url`, a working no-login Share Link. Relay this link for immediate viewing, not the `private_url`.",
            "A signed-in human opens the `claim_url` to keep, unlock interactivity, and move the Artifact into their Personal Workspace. That browser session chooses the destination Workspace.",
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
      id: "claim-code",
      title: "Claim Code rules",
      blocks: [
        {
          kind: "list",
          items: [
            "A Claim Code has the public shape `clm_...` and is optional analytics attribution for copied prompts.",
            "It is not auth, ownership, billing, idempotency, a Claim Token, or a secret.",
            "When present on `publish --ephemeral`, the CLI sends it to the API and the API embeds it in the Claim Token for conversion attribution.",
            "It is never returned as `claim_code`, never added to `unlisted_url` or `claim_url`, and never placed in URL query strings.",
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
          text: "Claiming reparents the Artifact into the signed-in member's Personal Workspace. There is no user-backed session before claim; after claim, pre-claim ephemeral credentials stop working. The Artifact moves to the Free Plan limits unless the destination Workspace is already Pro.",
        },
      ],
    },
  ],
};
