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
          text: "Run `whoami --json`; signed-out results exit 0. If authenticated:false, use `login` locally or `login --device-code` in a sandbox. Keep it running while the user approves the URL/code from stderr, then check `whoami` again. See [remote login](/docs/cli#remote-login).",
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
          text: "Publish walks the file tree, uploads changed bytes, finalizes a Revision, and returns `url`.",
        },
        {
          kind: "code",
          language: "text",
          code: "https://01234-56789-abcde-fghjd.agent-paste.link/",
        },
        {
          kind: "paragraph",
          text: "Use `--artifact-id 01234-56789-abcde-fghjd` to update the same website. Full URLs also work. Omit the flag to create a new Artifact.",
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
          text: "Use this when login is unavailable and static accountless output meets the task, or when explicitly requested. Return `url` for viewing and `claim_url` when the human wants to keep the upload. The Artifact expires after 24 hours. Until it is claimed, scripts and connections stay blocked.",
        },
      ],
    },
  ],
};
