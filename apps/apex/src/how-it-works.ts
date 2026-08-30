export const HOW_IT_WORKS = {
  eyebrow: "How it works",
  headline: "Protected handoffs for agent work",
  lead: "agent-paste is built for work an agent generated and a person needs to inspect. The safety model is straightforward: keep each Workspace separate, isolate generated content by origin, use unguessable URLs, and let handoffs expire.",
};

export type HowItWorksSection = {
  title: string;
  body: string[];
};

export const HOW_IT_WORKS_SECTIONS: HowItWorksSection[] = [
  {
    title: "Your Workspace stays separate",
    body: [
      "Artifacts, audit records, and settings belong to a Workspace. A publish from one Workspace is not mixed with another Workspace's data.",
      "Human sign-in, CLI credentials, and MCP OAuth are checked against that boundary. A credential can publish for its Workspace, but it is not a broad pass into the rest of the system.",
    ],
  },
  {
    title: "Storage stays private",
    body: [
      "Artifact files are encrypted and stored privately. Viewers never receive raw storage links. They receive an unguessable capability hostname backed by signed authorization.",
      "That URL is a controlled handoff, not a public bucket address.",
    ],
  },
  {
    title: "Generated content is isolated",
    body: [
      "Agent output is treated as untrusted. Each Artifact runs top-level on a separate capability origin, away from the dashboard and account session.",
      "That separation matters most for generated HTML. The page you inspect can be useful without being treated as part of the trusted app.",
    ],
  },
  {
    title: "Handoffs end",
    body: [
      "Delete an Artifact when its URL should stop working, or let Workspace Auto Deletion expire it. Platform deny controls can disable abusive content immediately.",
      "Stored credentials are scoped and replaceable. Secrets are shown once when created and stored in non-recoverable verifier form.",
    ],
  },
  {
    title: "Unclaimed work expires quickly",
    body: [
      "An agent should use the CLI when it can run commands and a Workspace login is available. A hosted tool that cannot run commands should use MCP. Reserve `--ephemeral` for cases where no login is available, with short-lived credentials, low write caps, 24 hour cleanup, and noindex.",
      "Ephemeral HTML uses the same script-enabled top-level behavior as authenticated content.",
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
