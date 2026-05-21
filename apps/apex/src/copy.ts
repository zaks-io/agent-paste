export const APP_BASE_URL = "https://app.agent-paste.sh";
export const SIGN_IN_URL = `${APP_BASE_URL}/login`;
export const API_BASE_URL = "https://api.agent-paste.sh";
export const MCP_BASE_URL = "https://mcp.agent-paste.sh";

export const WORDMARK = {
  base: "agent-paste",
  tld: ".sh",
};

export const TITLE = "agent-paste.sh — publish artifacts from your agents";
export const META_DESCRIPTION =
  "A publish target for AI agents. One CLI call uploads a folder and returns a durable, addressable artifact.";

export const HERO = {
  headline: "Where agents publish",
  lead: "A publish target for AI agents. One call uploads a folder, returns a durable URL.",
  primary: { label: "Get an API key", href: SIGN_IN_URL },
};

export type TranscriptLine =
  | { kind: "prompt"; text: string }
  | { kind: "comment"; text: string }
  | { kind: "output"; text: string }
  | { kind: "result"; origin: string; id: string };

export const TRANSCRIPT: TranscriptLine[] = [
  { kind: "prompt", text: "npx agent-paste publish ./report" },
  { kind: "result", origin: "https://agent-paste.sh/", id: "art_01HZ8K2X9NPQR3VW7TYBE5MCDF" },
];
