export const HOW_IT_WORKS = {
  eyebrow: "How it works",
  headline: "Protected handoffs for agent work",
  lead: "agent-paste is built for work an agent generated and a person needs to inspect. The safety model is straightforward: keep each Workspace separate, keep files private until shared, isolate generated content, make access revocable, and let handoffs expire.",
};

export type HowItWorksSection = {
  title: string;
  body: string[];
};

export const HOW_IT_WORKS_SECTIONS: HowItWorksSection[] = [
  {
    title: "Your Workspace stays separate",
    body: [
      "Artifacts, keys, audit records, and settings belong to a Workspace. A publish from one Workspace is not mixed with another Workspace's data.",
      "Human sign-in, API Keys, and share links are all checked against that boundary. A key can publish for its Workspace, but it is not a broad pass into the rest of the system.",
    ],
  },
  {
    title: "Files stay private until shared",
    body: [
      "Artifact files are stored privately. Viewers do not receive raw storage links. They receive signed, expiring access paths created for the Artifact they are allowed to see.",
      "That means a shared link is a controlled handoff, not a public bucket URL that escapes the product.",
    ],
  },
  {
    title: "Generated content is isolated",
    body: [
      "Agent output is treated as untrusted. It is displayed from a separate content domain, away from the dashboard and account session.",
      "That separation matters most for generated HTML. The page you inspect can be useful without being treated as part of the trusted app.",
    ],
  },
  {
    title: "Sharing can be revoked",
    body: [
      "Access Links are revocable. If a link is sent to the wrong place or should no longer work, access can be cut off without deleting the underlying Artifact.",
      "API Keys are also scoped and replaceable. Secrets are shown once when created and stored in non-recoverable verifier form.",
    ],
  },
  {
    title: "Unclaimed work expires quickly",
    body: [
      "An agent can publish before a human signs in. Those unclaimed handoffs use short-lived credentials, low write caps, 24 hour cleanup, noindex, and a script-disabled content policy.",
      "A human can claim the Artifact into a Workspace before it expires. Until then, it is treated as a short-lived handoff, not a permanent place to keep data.",
    ],
  },
  {
    title: "What this does not promise",
    body: [
      "agent-paste does not inspect or certify uploaded content as safe, and it does not promise malware detection. The enforceable controls are separation, signed access, expiration, rate limits, revocation, and deletion.",
      "It is also not permanent storage and not a deploy platform. Keep your source. Use agent-paste for the handoff.",
    ],
  },
];
