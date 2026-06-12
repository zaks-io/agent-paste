// Long-form "about" copy. The brand guide designates the manifesto as the
// about block and the one place the voice is allowed to be expansive
// (marketing-brand-guide.md section 2). Everything here stays in that register:
// the wedge stated quietly, honest about scope, no hype, and current public
// source positioning.

export const ABOUT = {
  eyebrow: "About",
  headline: "Where agents publish",
  lead: "The web spent thirty years assuming a human at a keyboard. Agents publish now too, and the tools we reach for were built for the older assumption. agent-paste is the small, deliberate fix for that.",
};

export type AboutSection = {
  // Section heading.
  title: string;
  // One or more prose paragraphs. `backtick` spans render as inline <code>.
  body: string[];
};

export const ABOUT_SECTIONS: AboutSection[] = [
  {
    title: "The gap",
    body: [
      "An agent renders an HTML report, builds a dashboard, or turns out a folder of work in an afternoon. That work needs four things at once: a URL a human can open, a manifest another agent can read, a hard isolation boundary because nobody wrote the contents by hand, and a short life so it does not pile up forever.",
      "No existing tool gives all four. A pastebin is one document. A file host has no artifact model. A deploy platform wants a repo, a build, and an ongoing hosting liability. A model vendor's artifact feature is locked to that vendor's chat, auth-walled, with no machine-readable way to hand the work out.",
      "agent-paste fills exactly that gap and nothing wider. Point the agent at agent-paste.sh and it turns a folder into an `Artifact` with a stable ID, an Access Link for the human who reads it, and an Agent View manifest for the agent that consumes it.",
    ],
  },
  {
    title: "Why it exists",
    body: [
      "This started as one concrete need. An agent produced something worth opening, and there was no good way to get a single URL out of the tool that made it and into the next tool or the next person. Not a Vercel project, not a repo, not a paste buried in a thread. Just an address.",
      "That need turned out to be a real and narrow wedge. Model vendors keep shipping their own artifact surfaces, which proves the demand and, at the same time, makes the case for a neutral layer that does not belong to any one of them. Cross-vendor handoff works against the lock-in those surfaces exist to create, so the incumbents are unlikely to build it. That is the kind of gap a neutral third party gets to own.",
    ],
  },
  {
    title: "The principles, and the boundaries",
    body: [
      "The shape of the product is mostly a list of things it refuses to become. It is not a deploy or hosting platform. It is not permanent storage. It is not a social network with feeds and stars. Naming those boundaries is what protects the wedge.",
      "What it is: vendor-neutral by construction, machine-readable first, transient by default, and untrusted by design. Content is treated as unsafe until it is isolated, because nobody typed it by hand. A handoff, not a vault. Built to cover its own costs rather than to grow at all costs.",
    ],
  },
  {
    title: "How it is built and run",
    body: [
      "Honest and up front: AI was used heavily to build this, and still is. That is not a feature of the product and it is not a confession. It is simply how the work got done. The intent was to hold a high engineering bar regardless of who or what wrote a given line: typed end to end, tested, reviewed against security and data-contract invariants before anything merges, with a documented workflow that treats every change the same way. The product is meant to stand on its own quality. Whether a human or an agent produced a line should not matter, and the bar is set so that it does not.",
      "It is also a small, independent project, run by one person for now. That has an upside, a clear point of view and no committee, and an honest downside worth stating plainly below.",
    ],
  },
  {
    title: "What to expect",
    body: [
      "This is live in early alpha. Nothing here is a promise of permanence. `Artifacts` follow Workspace Auto Deletion policy by default, because the product is a handoff and not a place to keep your only copy of something. Keep the source of anything you publish.",
      "Because it is solo-run and still early, expect the honest limits of that: a small surface, modest and explicit quotas, and the occasional rough edge. Naming a boundary is not an apology here. A product confident enough to say where it stops is easier to trust than one that pretends to do everything.",
    ],
  },
];
