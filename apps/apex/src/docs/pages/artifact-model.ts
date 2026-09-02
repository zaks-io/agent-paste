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
            ["Artifact", "Durable folder-like package containing one or more files."],
            ["Revision", "Immutable saved state of an Artifact."],
            ["Published Revision", "Revision currently visible at the Artifact URL."],
            ["Artifact URL", "Unguessable top-level capability website returned by publish."],
            ["Artifact Console", "Login-walled management page at `/artifacts/<id>`; never returned by publish."],
            ["Agent View", "Machine-readable Artifact and Revision metadata with per-file URLs."],
            ["Bundle", "Downloadable archive of a complete Revision tree."],
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
          text: "Artifact and Revision IDs are management identities. The Artifact URL uses an independent random 95-bit capability ID, so it does not expose either management ID.",
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
          text: "Publishing to an existing Artifact creates a new Published Revision and rewrites the capability manifest in place. The URL stays unchanged. Draft Revisions are never served there.",
        },
      ],
    },
  ],
};
