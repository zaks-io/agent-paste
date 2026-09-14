import { SKILL_INSTALL_CMD } from "../../copy";
import type { DocsPage } from "../types";

export const GETTING_STARTED_DOC: DocsPage = {
  slug: "getting-started",
  title: "Getting Started",
  shortTitle: "Start",
  summary: "Check auth, publish, and hand back one URL.",
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
          text: "`npx` needs Node.js 24+. Install `@zaks-io/agent-paste` globally for repeated use.",
        },
      ],
    },
    {
      id: "authenticate",
      title: "Authenticate",
      blocks: [
        {
          kind: "paragraph",
          text: "`whoami --json` exits 0 even when signed out, so check `authenticated`. If false, run `login` where a browser is available or `login --device-code` in a sandbox. See [remote login](/docs/cli#remote-login).",
        },
      ],
    },
    {
      id: "agent-skill",
      title: "Install the agent skill",
      blocks: [
        {
          kind: "paragraph",
          text: "The skill teaches Claude Code and Codex the publish, revise, ephemeral, and MCP workflows.",
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
          text: "Publish uploads the file tree and returns `url`, which opens without login.",
        },
        {
          kind: "code",
          language: "text",
          code: "https://01234-56789-abcde-fghjd.agent-paste.link/",
        },
        {
          kind: "paragraph",
          text: "Pass `--artifact-id 01234-56789-abcde-fghjd` (or the full URL) to update the same website. Omit it to create a new Artifact.",
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
          text: "Use this when login is unavailable or the user asks for accountless publishing. Return `url`, plus `claim_url` if the user wants to keep the upload. The Artifact expires in 24 hours and blocks scripts and network until claimed. See [Ephemeral](/docs/ephemeral).",
        },
      ],
    },
  ],
};
