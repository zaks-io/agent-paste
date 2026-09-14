import type { DocsPage } from "../types";

export const LIMITS_DOC: DocsPage = {
  slug: "limits",
  title: "Limits and Retention",
  shortTitle: "Limits",
  summary: "Plan caps and Auto Deletion keep handoffs useful without becoming permanent storage.",
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
            "100 published Revisions per Artifact, lifetime.",
            "60 authenticated requests per minute per actor.",
            "300 authenticated requests per minute per Workspace.",
            "50 pinned Artifacts per Workspace.",
          ],
        },
        {
          kind: "paragraph",
          text: "Authenticated clients can read their effective caps from `GET /v1/usage-policy`.",
        },
      ],
    },
    {
      id: "retention",
      title: "Retention",
      blocks: [
        {
          kind: "paragraph",
          text: "Every Artifact has Auto Deletion. Free Workspaces default to 3 days and can choose up to 7; Pro defaults to 30 and can choose up to 90. Ephemeral Artifacts delete after 24 hours unless claimed. Pinned Artifacts are exempt while pinned.",
        },
      ],
    },
    {
      id: "write-allowance",
      title: "Write allowance",
      blocks: [
        {
          kind: "paragraph",
          text: "The daily allowance counts new Artifacts only. Revisions of an existing Artifact are free up to its 100-Revision lifetime ceiling.",
        },
      ],
    },
  ],
};
