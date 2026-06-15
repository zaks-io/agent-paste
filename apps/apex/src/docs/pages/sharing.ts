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
            [
              "Share Link",
              "Access Link type that follows the latest Published Revision; created by `set-visibility unlisted`.",
            ],
            ["Revision Link", "Snapshot Access Link pinned to one specific Revision."],
            [
              "Private Link",
              "Login-walled clean viewer (`/v/<artifactId>`) for a Workspace Member; the `private_url` publish returns.",
            ],
            ["Artifact Console", "Dashboard-only management page (`/artifacts/<id>`); never returned by publish."],
            ["Access Link Signed URL", "URL minted from an Access Link. Returned as `unlisted_url` for a Share Link."],
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
          text: "Use Access Link Signed URLs minted from Share Links only for explicit unlisted no-login handoff. They open the controlled Artifact Viewer and follow later publishes. Use Revision Links or Revision Content URLs only when the reader must see one exact Revision as raw bytes. Do not send a direct `usercontent` URL as the final live page.",
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
          text: "MCP can set visibility to `unlisted`, create Revision Links, list links, and revoke links for authenticated members. On the CLI, `agent-paste set-visibility <artifact-id> unlisted` creates or reuses the Share Link; `agent-paste set-visibility <artifact-id> private` revokes active Access Links. Publish itself is content-only and never creates a Share Link. Ongoing link listing and revocation stay in the dashboard or MCP.",
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
          text: 'A Workspace Member opens the `private_url` clean viewer (`/v/<artifactId>`) by default. When a user explicitly asks for a shareable no-login page, run `agent-paste set-visibility <artifact-id> unlisted` on the CLI, or the MCP `set_visibility` tool with `visibility: "unlisted"`, to mint or reuse the unlisted Share Link and return `unlisted_url`. Use Agent View when an agent needs file trees, metadata, or signed per-file URLs.',
        },
      ],
    },
  ],
};
