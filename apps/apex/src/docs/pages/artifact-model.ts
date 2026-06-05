import type { DocsPage } from "../types.js";

export const ARTIFACT_MODEL_DOC: DocsPage = {
  slug: "artifact-model",
  title: "Artifact Model",
  shortTitle: "Model",
  summary: "One Artifact ID flows through CLI, REST, MCP, dashboard, viewers, and agent manifests.",
  sections: [
    {
      id: "objects",
      title: "Objects",
      blocks: [
        {
          kind: "table",
          columns: ["Object", "Meaning"],
          rows: [
            ["Workspace", "The tenant that owns Artifacts, members, API Keys, Plan, and Audit Events."],
            ["Artifact", "A durable, addressable folder-like package containing one or more files."],
            ["Revision", "An immutable saved state of an Artifact after publish. New publishes append Revisions."],
            ["Published Revision", "The Revision currently visible through stable Artifact links."],
            ["Access Link", "A revocable signed URL for a Share Link or a Revision Link."],
            ["Bundle", "A downloadable archive generated from a complete Revision file tree."],
          ],
        },
      ],
    },
    {
      id: "ids",
      title: "Stable IDs",
      blocks: [
        {
          kind: "paragraph",
          text: "The Artifact ID printed by the CLI is the same ID used by REST, MCP, and the dashboard. You do not need per-tool translation tables.",
        },
        {
          kind: "code",
          language: "text",
          code: "art_01HZ8K2X9NPQR3VW7TYBE5MCDF\nrev_01HZ8K2X9NPQR3VW7TYBE5MCDF",
        },
      ],
    },
    {
      id: "revisions",
      title: "Revisions and Live Updates",
      blocks: [
        {
          kind: "paragraph",
          text: "Publishing to an existing Artifact creates a new Published Revision. Old Revisions remain addressable through Revision Links while retained by the Workspace policy.",
        },
        {
          kind: "paragraph",
          text: "On Pro, Live Updates let already-open Private Link or Share Link viewers advance to the latest Published Revision without a manual reload. Draft Revisions are never revealed.",
        },
      ],
    },
    {
      id: "agent-view",
      title: "Agent View",
      blocks: [
        {
          kind: "paragraph",
          text: "Agent View is JSON for machines. It includes Artifact and Revision IDs, title, entrypoint, file metadata, signed per-file URLs, and Bundle Availability. It does not inline file bytes.",
        },
      ],
    },
  ],
};
