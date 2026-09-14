import type { DocsPage } from "../types";

export const SHARING_DOC: DocsPage = {
  slug: "sharing",
  title: "Artifact URLs",
  shortTitle: "URLs",
  summary: "Every publish returns one website URL.",
  sections: [
    {
      id: "one-url",
      title: "One URL",
      blocks: [
        {
          kind: "paragraph",
          text: "Publish returns `url`. It opens without login, and its hostname is the 23-character artifact ID under `agent-paste.link`. Send it to the recipient as is.",
        },
        {
          kind: "code",
          language: "text",
          code: "https://01234-56789-abcde-fghjd.agent-paste.link/",
        },
      ],
    },
    {
      id: "revisions",
      title: "Revisions",
      blocks: [
        {
          kind: "paragraph",
          text: "Pass the artifact ID or full URL to `--artifact-id` to update the same website. Updates require Workspace access; the URL alone grants read only.",
        },
      ],
    },
    {
      id: "security",
      title: "Security boundary",
      blocks: [
        {
          kind: "paragraph",
          text: "The hostname carries at least 95 bits of random entropy and is the only credential a reader needs. The content Worker checks the manifest, signed authorization, expiry, denylist, and requested path before serving encrypted R2 bytes.",
        },
      ],
    },
  ],
};
