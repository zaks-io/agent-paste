import type { DocsPage } from "../types";

export const DASHBOARD_DOC: DocsPage = {
  slug: "dashboard",
  title: "Dashboard",
  shortTitle: "Dashboard",
  summary: "The human control plane for Workspaces, Artifacts, billing, and settings.",
  sections: [
    {
      id: "sign-in",
      title: "Sign in",
      blocks: [
        {
          kind: "paragraph",
          text: "Open [app.agent-paste.sh](https://app.agent-paste.sh) or run `agent-paste login`. From a sandbox or SSH session, use `agent-paste login --device-code` and approve in your own browser. See [remote login](/docs/cli#remote-login).",
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
            ["`/artifacts`", "Artifact list with status, pinning, Bundle state, URL, and last publish time."],
            ["`/artifacts/{artifactId}`", "Artifact detail, URL, Revisions, Bundle state, warnings, and delete."],
            ["`/keys`", "Create and revoke member credentials."],
            ["`/audit`", "Workspace Audit Events."],
            ["`/settings`", "Workspace name and default retention."],
            ["`/billing`", "Plan, remaining writes, Checkout, Portal, and invoices."],
          ],
        },
      ],
    },
    {
      id: "claim",
      title: "Claiming ephemeral work",
      blocks: [
        {
          kind: "paragraph",
          text: "`/claim#<token>` requires a signed-in human and moves the ephemeral Artifact into that member's Personal Workspace.",
        },
      ],
    },
  ],
};
