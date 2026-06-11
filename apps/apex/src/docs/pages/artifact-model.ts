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
            ["Artifact URL", "The authenticated Artifact detail URL for Workspace management."],
            [
              "Revision Content URL",
              "A signed Content Origin byte URL for one exact Revision. It expires, does not Live Update, and direct HTML there is inert.",
            ],
            ["Access Link", "A revocable grant family for unauthenticated read access."],
            ["Share Link", "Access Link type that follows the latest Published Revision."],
            ["Revision Link", "A snapshot Access Link pinned to one specific Revision."],
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
          text: "Publish creates stable Artifact and Revision IDs. The default post-publish `View` is the authenticated Artifact URL. Public/shareable handoff requires an explicit Share Link, whose `access_link_url` opens the controlled Artifact Viewer. The direct `usercontent.agent-paste.sh/v/...` URL is the Revision Content URL for one exact Revision and is raw byte delivery, not the product viewer.",
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
          text: "On Pro, Live Updates let already-open Artifact Viewers opened through Share Links or authenticated Private Links advance to the latest Published Revision without a manual reload. Revision Links and Revision Content URLs are pinned to one Revision and do not Live Update. Draft Revisions are never revealed.",
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
