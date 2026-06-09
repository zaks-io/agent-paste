import type { DocsPage } from "../types";

export const ARTIFACT_MODEL_DOC: DocsPage = {
  slug: "artifact-model",
  title: "Artifact Model",
  shortTitle: "Model",
  summary: "Artifacts, Revisions, Access Links, and Agent View are the core handoff objects.",
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
            [
              "Artifact URL",
              "The app-origin live viewer for an Artifact. It resolves to the latest Published Revision.",
            ],
            [
              "Revision Content URL",
              "A signed Content Origin URL for one exact Revision. It expires and does not Live Update.",
            ],
            ["Access Link", "A revocable signed URL for a Share Link or a Revision Link."],
            ["Share Link", "An Access Link that resolves to the latest Published Revision of an Artifact."],
            ["Bundle", "A downloadable archive generated from a complete Revision file tree."],
          ],
        },
      ],
    },
    {
      id: "ids",
      title: "IDs and handoff URLs",
      blocks: [
        {
          kind: "paragraph",
          text: "Publish returns stable Artifact and Revision IDs plus an Artifact URL for the live viewer. The direct `usercontent.agent-paste.sh/v/...` URL is the Revision Content URL for one exact Revision.",
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
          text: "On Pro, Live Updates let already-open Artifact URL, Private Link, or Share Link viewers advance to the latest Published Revision without a manual reload. Revision Links and Revision Content URLs are pinned to one Revision and do not Live Update. Draft Revisions are never revealed.",
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
