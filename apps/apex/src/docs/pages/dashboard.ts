import type { DocsPage } from "../types.js";

export const DASHBOARD_DOC: DocsPage = {
  slug: "dashboard",
  title: "Dashboard",
  shortTitle: "Dashboard",
  summary: "The dashboard is the human control plane for Workspaces, Artifacts, links, keys, billing, and settings.",
  sections: [
    {
      id: "sign-in",
      title: "Sign in",
      blocks: [
        {
          kind: "paragraph",
          text: "Open [app.agent-paste.sh](https://app.agent-paste.sh) or run `agent-paste login`. Both use WorkOS-backed browser auth. The CLI login mints a scoped API Key for local use.",
        },
      ],
    },
    {
      id: "pages",
      title: "Pages",
      blocks: [
        {
          kind: "table",
          columns: ["Page", "Purpose"],
          rows: [
            ["`/dashboard`", "Workspace overview, Usage Policy, recent Artifacts, and recent Audit Events."],
            [
              "`/artifacts`",
              "Artifact list with status, pinning, Bundle state, Access Link Lockdown, and last publish time.",
            ],
            [
              "`/artifacts/{artifactId}`",
              "Artifact detail, viewer, Revisions, Access Links, Bundle state, warnings, and delete action.",
            ],
            ["`/access-links`", "Workspace-wide Access Link list and management."],
            ["`/keys`", "Create, reveal once, list, and revoke API Keys."],
            ["`/audit`", "Workspace Audit Event list."],
            ["`/settings`", "Workspace name and default retention settings."],
            ["`/settings/billing`", "Plan, remaining writes, Checkout, Portal, and invoices."],
          ],
        },
      ],
    },
    {
      id: "keys",
      title: "API Keys",
      blocks: [
        {
          kind: "paragraph",
          text: "Dashboard-created keys are shown once and cannot be recovered later. Store them where your agent or CI can read `AGENT_PASTE_API_KEY`. Keys are capped at `publish` and `read`, never member-only admin scopes.",
        },
      ],
    },
    {
      id: "claim",
      title: "Claiming ephemeral work",
      blocks: [
        {
          kind: "paragraph",
          text: "The claim page accepts `/claim#<token>`. It requires a signed-in human and promotes the Ephemeral Workspace's Artifact into that member's Personal Workspace.",
        },
      ],
    },
  ],
};
