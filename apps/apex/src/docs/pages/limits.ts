import type { DocsPage } from "../types.js";

export const LIMITS_DOC: DocsPage = {
  slug: "limits",
  title: "Limits and Retention",
  shortTitle: "Limits",
  summary: "Billing-enabled limits keep handoffs useful without turning the service into permanent storage.",
  sections: [
    {
      id: "plan-limits",
      title: "Plan limits",
      blocks: [
        {
          kind: "table",
          columns: ["Limit", "Ephemeral", "Free", "Pro"],
          rows: [
            ["Daily new Artifacts", "20", "100", "2000"],
            ["File size cap", "10 MB", "10 MB", "25 MB"],
            ["Artifact size cap", "25 MB", "25 MB", "100 MB"],
            ["Bundle size cap", "25 MB", "25 MB", "100 MB"],
            ["Default TTL", "24h", "3d", "30d"],
            ["Max TTL", "24h", "7d", "90d"],
            ["Live Artifacts", "low-cap unclaimed Workspace", "50", "1000"],
            ["Live Updates", "No", "No", "Yes"],
          ],
        },
      ],
    },
    {
      id: "shared-limits",
      title: "Shared limits",
      blocks: [
        {
          kind: "list",
          items: [
            "100 files per Revision.",
            "100 lifetime published Revisions per Artifact.",
            "60 authenticated requests per minute per actor.",
            "300 authenticated requests per minute per Workspace.",
            "Pinned Artifact cap: 50 per Workspace.",
          ],
        },
      ],
    },
    {
      id: "retention",
      title: "Retention",
      blocks: [
        {
          kind: "paragraph",
          text: "Every Artifact has Auto Deletion. Free Workspaces default to 3 days and can choose up to 7 days. Pro Workspaces default to 30 days and can choose up to 90 days. Ephemeral Artifacts auto-delete after 24 hours unless claimed.",
        },
        {
          kind: "paragraph",
          text: "Pinned Artifacts are exempt from Auto Deletion while they remain pinned, subject to the Workspace cap. Non-current Revisions are retained according to policy and Revision links stop working after a retained Revision is removed.",
        },
      ],
    },
    {
      id: "write-allowance",
      title: "Write allowance",
      blocks: [
        {
          kind: "paragraph",
          text: "The daily allowance counts new Artifacts. New Revisions of an existing Artifact do not count against the daily new-Artifact allowance, but each Artifact still has a 100 lifetime Revision ceiling.",
        },
      ],
    },
  ],
};
