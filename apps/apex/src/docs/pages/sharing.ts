import type { DocsPage } from "../types";

export const SHARING_DOC: DocsPage = {
  slug: "sharing",
  title: "Artifact URLs",
  shortTitle: "URLs",
  summary: "Every publish returns one top-level website URL.",
  sections: [
    {
      id: "one-url",
      title: "One URL",
      blocks: [
        {
          kind: "paragraph",
          text: "Publish returns `url`, the complete unguessable capability URL that opens without login. Its hostname is the 23-character capability ID under `agent-paste.link`. It is the Artifact itself, not an app viewer or redirect.",
        },
        {
          kind: "code",
          language: "text",
          code: "https://01234-56789-abcde-fghjd.agent-paste.link/",
        },
        {
          kind: "paragraph",
          text: "There is no iframe, sandbox, Access Link wrapper, private viewer URL, or separate visibility command. Send `url` to the recipient.",
        },
      ],
    },
    {
      id: "revisions",
      title: "Revisions",
      blocks: [
        {
          kind: "paragraph",
          text: "Publishing with the existing `artifact_id` creates a new Revision and repoints the same hostname. Refreshing the URL shows the latest Published Revision.",
        },
      ],
    },
    {
      id: "security",
      title: "Security boundary",
      blocks: [
        {
          kind: "paragraph",
          text: "The hostname carries at least 95 bits of random entropy and acts as the bearer locator. The content Worker validates its manifest, signed authorization, expiry, denylist, and requested path before serving encrypted R2 bytes.",
        },
      ],
    },
  ],
};
