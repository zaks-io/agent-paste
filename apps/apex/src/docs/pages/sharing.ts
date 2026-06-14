import type { DocsPage } from "../types";

export const SHARING_DOC: DocsPage = {
  slug: "sharing",
  title: "Sharing and Access Links",
  shortTitle: "Sharing",
  summary: "Share human-readable viewers and machine-readable manifests without exposing credentials.",
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
            ["Access Link Signed URL", "URL minted from an Access Link. Return one only after explicit sharing."],
            [
              "Revision Content URL",
              "Direct signed `usercontent.agent-paste.sh/v/...` byte URL for one specific Revision; direct HTML there is inert.",
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
          text: "Use Access Link Signed URLs minted from Share Links only for explicit public/shareable handoff. They open the controlled Artifact Viewer and follow later publishes. Use Revision Links or Revision Content URLs only when the reader must see one exact Revision as raw bytes. Do not send a direct `usercontent` URL as the final live page.",
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
          text: "MCP can create Share Links and Revision Links, list links, and revoke links for authenticated members. CLI publish can create a Share Link only when called with `--share`; ongoing link listing and revocation stay in the dashboard or MCP.",
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
          text: "A Workspace Member opens the authenticated Artifact URL by default. When a user explicitly asks for a public/shareable page, publish with CLI `--share` or MCP `share:true` and return `viewer_url` (now the public Share Link), or mint one explicitly with the `create_share_link` tool, which returns it as `url`. Use Agent View when an agent needs file trees, metadata, or signed per-file URLs.",
        },
      ],
    },
  ],
};
