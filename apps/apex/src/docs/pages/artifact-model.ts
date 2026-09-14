import type { DocsPage } from "../types";

export const ARTIFACT_MODEL_DOC: DocsPage = {
  slug: "artifact-model",
  title: "Artifact Model",
  shortTitle: "Model",
  summary: "Artifacts, Revisions, capability URLs, and Agent View are the core objects.",
  sections: [
    {
      id: "objects",
      title: "Objects",
      blocks: [
        {
          kind: "table",
          columns: ["Object", "Meaning"],
          rows: [
            ["Workspace", "Tenant that owns Artifacts, members, policy, and Audit Events."],
            ["Artifact", "Folder-like package of one or more files."],
            ["Revision", "Immutable saved state of an Artifact."],
            ["Published Revision", "Revision currently served at the Artifact URL."],
            ["Artifact URL", "Unguessable website returned by publish."],
            ["Artifact Console", "Login-walled management page at `/artifacts/<id>`."],
            ["Agent View", "Machine-readable Artifact and Revision metadata with per-file URLs."],
            ["Bundle", "Downloadable archive of a complete Revision."],
          ],
        },
      ],
    },
    {
      id: "identity",
      title: "IDs and URLs",
      blocks: [
        {
          kind: "paragraph",
          text: "Artifact and Revision IDs are management identities. The Artifact URL uses a separate random capability ID, so it exposes neither.",
        },
        {
          kind: "code",
          language: "text",
          code: "art_01HZ8K2X9NPQR3VW7TYBE5MCDF\nrev_01HZ8K2X9NPQR3VW7TYBE5MCDF\nhttps://01234-56789-abcde-fghjd.agent-paste.link/",
        },
      ],
    },
    {
      id: "revisions",
      title: "Revisions",
      blocks: [
        {
          kind: "paragraph",
          text: "Publishing to an existing Artifact creates a new Published Revision at the same URL. Draft Revisions are never served.",
        },
      ],
    },
  ],
};
