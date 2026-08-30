import type { DocsPage } from "../types";

export const SAFETY_DOC: DocsPage = {
  slug: "safety",
  title: "Safety and Content Isolation",
  shortTitle: "Safety",
  summary: "agent-paste treats uploaded work as untrusted content and isolates serving from control-plane auth.",
  sections: [
    {
      id: "what-not-to-publish",
      title: "What not to publish",
      blocks: [
        {
          kind: "paragraph",
          text: "Every published Artifact has an unguessable capability URL. Anyone holding that URL can read it until the Artifact expires, is disabled, or is deleted. Treat Artifact URLs as sensitive.",
        },
        {
          kind: "paragraph",
          text: "Do not upload secrets or other people's data. In particular:",
        },
        {
          kind: "list",
          items: [
            "Tokens, passwords, private keys, `.env` files, or any other credential.",
            "Personal or customer data you are not authorized to share or required to protect.",
            "Anything you would not be comfortable handing to whoever holds the link.",
          ],
        },
        {
          kind: "paragraph",
          text: "If you publish a secret by mistake, rotate it and delete or revoke the Artifact. Deletion can make content unreachable before every backup, cache, or queued cleanup job has finished.",
        },
      ],
    },
    {
      id: "origin-boundary",
      title: "Origin boundary",
      blocks: [
        {
          kind: "paragraph",
          text: "Every Artifact is served top-level from its own `{capability}.agent-paste.sh` origin, never the dashboard or API origin. R2 stays private and clients never receive direct storage URLs. The authentication cookie is host-only and is not sent to Artifact hosts.",
        },
      ],
    },
    {
      id: "headers",
      title: "Response policy",
      blocks: [
        {
          kind: "paragraph",
          text: "The content origin verifies signed tokens, expiration, scope, denylist state, and requested path. Authorization failures return generic not found responses.",
        },
        {
          kind: "paragraph",
          text: "Artifact HTML runs top-level with a compatibility-oriented CSP that allows inline scripts, external HTTPS dependencies, data and blob assets, workers, fetch, and secure WebSockets. `frame-ancestors 'none'` prevents another site from putting it back inside an iframe.",
        },
      ],
    },
    {
      id: "ephemeral-scripts",
      title: "Ephemeral script policy",
      blocks: [
        {
          kind: "paragraph",
          text: "Unclaimed ephemeral HTML uses the same script-enabled top-level policy as authenticated content. It differs through its shorter lifetime, lower write caps, and `noindex`, not through a second browser mode.",
        },
      ],
    },
    {
      id: "revocation",
      title: "Revocation",
      blocks: [
        {
          kind: "paragraph",
          text: "agent-paste does not certify uploaded content as safe. Artifacts can be deleted or disabled without exposing private storage URLs.",
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
            "Stored credentials are non-recoverable after creation.",
            "Claim Tokens ride the URL hash and are stored hashed.",
            "Capability hostnames are bearer locators and must not be logged in full.",
            "Tokens, signed URLs, and credential secret material must not be logged.",
          ],
        },
      ],
    },
  ],
};
