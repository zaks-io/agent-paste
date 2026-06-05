import type { DocsPage } from "../types.js";

export const SAFETY_DOC: DocsPage = {
  slug: "safety",
  title: "Safety and Content Isolation",
  shortTitle: "Safety",
  summary: "agent-paste treats uploaded work as untrusted content and isolates serving from control-plane auth.",
  sections: [
    {
      id: "origin-boundary",
      title: "Origin boundary",
      blocks: [
        {
          kind: "paragraph",
          text: "Published files are served from `usercontent.agent-paste.sh`, not the dashboard or API origin. R2 stays private. Clients receive signed content URLs, never direct storage URLs.",
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
          text: "Untrusted content responses carry CSP, HSTS, X-Content-Type-Options, frame protections, Referrer-Policy, and permissions restrictions. SVG receives a stricter CSP.",
        },
      ],
    },
    {
      id: "ephemeral-scripts",
      title: "Ephemeral script policy",
      blocks: [
        {
          kind: "paragraph",
          text: "Unclaimed ephemeral HTML may contain scripts, but scripts do not execute. Static markup and CSS still render. After a human claims the Artifact into a regular Workspace, newly minted content URLs use the claimed Workspace execution policy.",
        },
      ],
    },
    {
      id: "scanning",
      title: "Scanning and lockdown",
      blocks: [
        {
          kind: "paragraph",
          text: "Publishes enqueue asynchronous Safety Scanner work. Warnings are advisory to readers and operators. Serious abuse can drive Platform Lockdown or Access Link Lockdown without exposing secrets.",
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
            "API Key secrets are shown once and stored hashed server-side.",
            "Claim Tokens ride the URL hash and are stored hashed.",
            "Signed Access Link credentials live in URL fragments.",
            "Tokens, signed URLs, and API Key secret material must not be logged.",
          ],
        },
      ],
    },
  ],
};
