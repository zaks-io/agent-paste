import type { DocsPage } from "../types";

export const SAFETY_DOC: DocsPage = {
  slug: "safety",
  title: "Safety and Content Isolation",
  shortTitle: "Safety",
  summary: "Uploaded work is untrusted content, served apart from the control plane.",
  sections: [
    {
      id: "what-not-to-publish",
      title: "What not to publish",
      blocks: [
        {
          kind: "paragraph",
          text: "Anyone holding an Artifact URL can read it until the Artifact expires, is disabled, or is deleted. Treat the URL as sensitive. Do not upload:",
        },
        {
          kind: "list",
          items: [
            "Tokens, passwords, private keys, `.env` files, or any other credential.",
            "Personal or customer data you are not authorized to share.",
            "Anything you would not hand to whoever holds the link.",
          ],
        },
        {
          kind: "paragraph",
          text: "If you publish a secret by mistake, rotate it and delete the Artifact. Deletion makes content unreachable before every cache and cleanup job finishes.",
        },
      ],
    },
    {
      id: "origin-boundary",
      title: "Origin boundary",
      blocks: [
        {
          kind: "paragraph",
          text: "Each Artifact is served top-level from its own `{capability}.agent-paste.link` origin, never from the dashboard or API origin. Storage stays private; clients never receive direct storage URLs. The auth cookie is host-only and never reaches Artifact hosts.",
        },
      ],
    },
    {
      id: "headers",
      title: "Response policy",
      blocks: [
        {
          kind: "paragraph",
          text: "The content origin verifies signed tokens, expiration, scope, denylist state, and requested path. Authorization failures return a generic not found.",
        },
        {
          kind: "paragraph",
          text: "Signed-in Artifact HTML runs with a permissive CSP: inline scripts, external HTTPS dependencies, data and blob assets, dedicated workers, fetch, and secure WebSockets. `frame-ancestors 'none'` keeps other sites from framing it. Service workers are blocked on every Artifact host.",
        },
      ],
    },
    {
      id: "ephemeral-scripts",
      title: "Ephemeral script policy",
      blocks: [
        {
          kind: "paragraph",
          text: "Unclaimed ephemeral HTML blocks scripts, connections, forms, frames, objects, and workers. Claiming keeps the URL and switches it to the signed-in policy.",
        },
      ],
    },
    {
      id: "revocation",
      title: "Revocation",
      blocks: [
        {
          kind: "paragraph",
          text: "agent-paste does not certify uploaded content as safe. Artifacts can be deleted or disabled at any time.",
        },
      ],
    },
    {
      id: "secret-handling",
      title: "Secret handling",
      blocks: [
        {
          kind: "list",
          items: [
            "Stored credentials cannot be recovered after creation.",
            "Claim Tokens ride the URL hash and are stored hashed.",
            "Capability hostnames are bearer locators; do not log them in full.",
            "Tokens, signed URLs, and credential secrets are never logged.",
          ],
        },
      ],
    },
  ],
};
