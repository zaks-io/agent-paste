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
          text: "Open [app.agent-paste.sh](https://app.agent-paste.sh) and sign in through your browser to manage your Workspace. CLI authentication is separate: an injected API key or saved login already authenticates commands. See [CLI authentication](/docs/cli#api-keys).",
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
            ["`/keys`", "Create and revoke API keys for CI, sandboxes, and headless agents."],
            ["`/audit`", "Workspace Audit Events."],
            ["`/settings`", "Workspace name and default retention."],
            ["`/billing`", "Plan, remaining writes, Checkout, Portal, and invoices."],
          ],
        },
      ],
    },
    {
      id: "api-keys",
      title: "API keys",
      blocks: [
        {
          kind: "paragraph",
          text: "Create a key at [API Keys](https://app.agent-paste.sh/keys) and save its one-time secret in your sandbox or CI secret configuration as `AGENT_PASTE_API_KEY`. The CLI uses an injected key without login; it takes precedence over saved login credentials. Never print it or pass it as a command argument. Revoke keys here when they are no longer needed. CLI `logout` leaves environment keys untouched. MCP uses OAuth and cannot use these keys. See [CLI authentication](/docs/cli#api-keys).",
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
