import { SKILL_INSTALL_CMD } from "../../copy";
import type { DocsPage } from "../types";

export const GETTING_STARTED_DOC: DocsPage = {
  slug: "getting-started",
  title: "Getting Started",
  shortTitle: "Start",
  summary: "Check auth, publish, and hand off one Artifact URL.",
  sections: [
    {
      id: "install",
      title: "Install",
      blocks: [
        {
          kind: "code",
          language: "sh",
          code: "npx @zaks-io/agent-paste whoami --json\nnpx @zaks-io/agent-paste publish ./report",
        },
        {
          kind: "paragraph",
          text: "Use `npx` for one-shot Node.js 24+ runs or install `@zaks-io/agent-paste` globally for repeated use.",
        },
      ],
    },
    {
      id: "authenticate",
      title: "Authenticate",
      blocks: [
        {
          kind: "paragraph",
          text: "`whoami --json` exits 0 when signed out, so inspect `authenticated`. If false and browser auth is possible, run `agent-paste login` before publishing.",
        },
      ],
    },
    {
      id: "agent-skill",
      title: "Install the agent skill",
      blocks: [
        {
          kind: "paragraph",
          text: "Install the repository's portable skill directly into Claude Code and Codex. It teaches agents the CLI-first publish, revise, ephemeral, and MCP workflows.",
        },
        {
          kind: "code",
          language: "sh",
          code: SKILL_INSTALL_CMD,
        },
      ],
    },
    {
      id: "publish",
      title: "Publish",
      blocks: [
        {
          kind: "paragraph",
          text: "Publish walks the file tree, uploads changed bytes, finalizes a Revision, and returns `url`. That URL opens as a top-level website without login. There is no iframe or second sharing step.",
        },
        {
          kind: "code",
          language: "text",
          code: "https://0123456789abcdef0123456789abcdef.agent-paste.link/",
        },
        {
          kind: "paragraph",
          text: "Use `--artifact-id <id>` to publish a new Revision at the same URL. Publishing without the ID creates a different Artifact and URL.",
        },
      ],
    },
    {
      id: "no-account",
      title: "Ephemeral fallback",
      blocks: [
        {
          kind: "code",
          language: "sh",
          code: "npx @zaks-io/agent-paste publish ./report --ephemeral --json",
        },
        {
          kind: "paragraph",
          text: "Use this only when login is unavailable or explicitly skipped. Return `url` for viewing and `claim_url` when the human wants to keep the upload. The Artifact expires after 24 hours and still supports JavaScript and external HTTPS dependencies.",
        },
      ],
    },
  ],
};
