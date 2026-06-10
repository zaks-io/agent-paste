import type { DocsPage } from "../types";

export const SHARING_DOC: DocsPage = {
  slug: "sharing",
  title: "Sharing and Access Links",
  shortTitle: "Sharing",
  summary: "Share human-readable viewers and machine-readable manifests without exposing API Keys.",
  sections: [
    {
      id: "link-types",
      title: "Link types",
      blocks: [
        {
          kind: "table",
          columns: ["Link", "Use"],
          rows: [
            ["Access Link", "Revocable grant family for unauthenticated read access."],
            ["Share Link", "Access Link type that follows the latest Published Revision."],
            ["Revision Link", "Snapshot Access Link pinned to one specific Revision."],
            ["Artifact URL", "Authenticated Artifact detail URL for Workspace management."],
            ["Access Link Signed URL", "URL minted from an Access Link. Return the one from a Share Link to humans."],
            [
              "Revision Content URL",
              "Direct signed `usercontent.agent-paste.sh/v/...` content URL for one specific Revision.",
            ],
            ["Agent View URL", "JSON manifest for agents, either authenticated or public through a signed token."],
          ],
        },
      ],
    },
    {
      id: "signed-url-shape",
      title: "Signed URL shape",
      blocks: [
        {
          kind: "paragraph",
          text: "Access Link Signed URLs are shaped like `https://app.agent-paste.sh/al/{publicId}#{blob}`. The signature payload lives in the URL fragment so it is not sent to servers in normal HTTP requests.",
        },
        {
          kind: "paragraph",
          text: "The `publicId` identifies the link row. The fragment is the credential. Re-minting creates a fresh signed URL with a fresh expiration.",
        },
        {
          kind: "paragraph",
          text: "Use Access Link Signed URLs minted from Share Links for stable human handoff. They open the Artifact Viewer and follow later publishes. Use Revision Links or Revision Content URLs only when the reader must see one exact Revision. Do not send an Artifact URL as the final live page.",
        },
      ],
    },
    {
      id: "manage",
      title: "Create, mint, revoke, lockdown",
      blocks: [
        {
          kind: "paragraph",
          text: "Use the dashboard Access Links page or Artifact detail page to create links, reveal freshly minted signed URLs, revoke links, or engage Access Link Lockdown for an Artifact.",
        },
        {
          kind: "paragraph",
          text: "MCP can create Share Links and Revision Links, list links, and revoke links for authenticated members. The CLI focuses on publish and does not manage Access Links directly.",
        },
        {
          kind: "note",
          title: "Revocation boundary",
          body: [
            "Revoking an Access Link stops future resolves and deny-lists already minted content URLs for that link. Deleting an Artifact is separate and makes the Artifact inaccessible.",
          ],
        },
      ],
    },
    {
      id: "recipients",
      title: "Recipients",
      blocks: [
        {
          kind: "paragraph",
          text: "A human opens the Access Link Signed URL in a browser. An agent should return `access_link_url` for a live page, and use Agent View when it needs file trees, metadata, or signed per-file URLs.",
        },
      ],
    },
  ],
};
