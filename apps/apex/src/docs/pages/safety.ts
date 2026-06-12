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
          text: "Published Artifacts are private to the Workspace by default. When you explicitly create an Access Link Signed URL, anyone with that URL can read the files until the Artifact or link expires, is revoked, or is deleted. Treat shared links as sensitive.",
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
          text: "Published files are served from `usercontent.agent-paste.sh`, not the dashboard or API origin. R2 stays private. Clients receive signed content URLs, never direct storage URLs. The content origin is byte delivery; direct top-level HTML there is inert and unbranded.",
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
          text: "Untrusted content responses carry CSP, HSTS, X-Content-Type-Options, frame protections, Referrer-Policy, and permissions restrictions. Interactive HTML execution is allowed only inside the controlled Artifact Viewer iframe; direct `usercontent` HTML gets `script-src 'none'`. SVG receives a stricter CSP.",
        },
      ],
    },
    {
      id: "ephemeral-scripts",
      title: "Ephemeral script policy",
      blocks: [
        {
          kind: "paragraph",
          text: "Unclaimed ephemeral HTML may contain scripts, but scripts do not execute. Static markup and CSS still render. After a human claims the Artifact into a regular Workspace, newly minted viewer URLs may use the claimed Workspace execution policy, but interactive HTML still runs only inside the controlled Artifact Viewer iframe.",
        },
      ],
    },
    {
      id: "revocation",
      title: "Revocation",
      blocks: [
        {
          kind: "paragraph",
          text: "agent-paste does not inspect or certify uploaded content as safe. Access Links can be revoked, and abusive content can be disabled without exposing private storage URLs.",
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
            "Signed Access Link credentials live in URL fragments.",
            "Tokens, signed URLs, and credential secret material must not be logged.",
          ],
        },
      ],
    },
  ],
};
