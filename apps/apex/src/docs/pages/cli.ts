import type { DocsPage } from "../types";

export const CLI_DOC: DocsPage = {
  slug: "cli",
  title: "CLI Reference",
  shortTitle: "CLI",
  summary: "The CLI is the primary publish surface for humans, agents, and CI.",
  sections: [
    {
      id: "commands",
      title: "Commands",
      blocks: [
        {
          kind: "table",
          columns: ["Command", "Purpose"],
          rows: [
            ["`agent-paste login`", "Authenticate through browser OAuth."],
            ["`agent-paste login --device-code`", "Authenticate from a sandbox with approval in your own browser."],
            ["`agent-paste logout`", "Revoke and remove the stored credential."],
            ["`agent-paste whoami --json`", "Report authentication, Workspace, actor, and scopes."],
            ["`agent-paste publish <path>`", "Publish a file or folder and return one top-level `url`."],
            ["`agent-paste pull <artifact-url> <path>`", "Read one stored file."],
            ["`agent-paste edit <artifact-url> <path>`", "Apply literal edits and publish a Revision."],
            ["`agent-paste version`", "Print the CLI version."],
            ["`agent-paste upgrade`", "Update a standalone binary install."],
          ],
        },
      ],
    },
    {
      id: "remote-login",
      title: "Remote login",
      blocks: [
        {
          kind: "code",
          language: "sh",
          code: "agent-paste whoami --json\nagent-paste login --device-code\nagent-paste whoami --json",
        },
        {
          kind: "paragraph",
          text: "Keep device login running while the user approves the URL and code from stderr in their browser, then check whoami again. Device login needs access to WorkOS and the API, but no local browser.",
        },
        {
          kind: "paragraph",
          text: "Existing credentials work without another login. AGENT_PASTE_API_KEY takes precedence over stored credentials. If authentication is unavailable, use --ephemeral for accountless static output or report the blocker.",
        },
      ],
    },
    {
      id: "publish",
      title: "Publish",
      blocks: [
        {
          kind: "code",
          language: "sh",
          code: "agent-paste publish ./report --json\nagent-paste publish ./report --artifact-id https://01234-56789-abcde-fghjd.agent-paste.link/ --json",
        },
        {
          kind: "paragraph",
          text: "Every publish returns `url`. It opens without login on the Artifact's own capability subdomain. `--artifact-id` revises the Artifact without changing that URL. Pass the published HTTPS URL, its bare subdomain `01234-56789-abcde-fghjd`, or an existing `art_...` ID. `pull` and `edit` accept the same forms. Updates require authentication for the owning Workspace.",
        },
        {
          kind: "code",
          language: "text",
          code: '✓ Published "report"\n\n  View      https://01234-56789-abcde-fghjd.agent-paste.link/\n  Expires   <expiration date>\n\n  Update    agent-paste publish ./report --artifact-id https://01234-56789-abcde-fghjd.agent-paste.link/\n\n  → open https://01234-56789-abcde-fghjd.agent-paste.link/',
        },
      ],
    },
    {
      id: "ephemeral",
      title: "Accountless publish",
      blocks: [
        {
          kind: "paragraph",
          text: "Run `whoami --json` first. When login is unavailable and static accountless output meets the task, or when explicitly requested, use `publish <path> --ephemeral --json`. Return `url`; return `claim_url` too when the human wants to keep the upload. Ephemeral HTML is static until claimed.",
        },
      ],
    },
    {
      id: "paths",
      title: "Files and entrypoints",
      blocks: [
        {
          kind: "paragraph",
          text: "Directory publish preserves relative paths and skips `.git`, `node_modules`, `.DS_Store`, and `.env*`. Entrypoint inference is `index.html`, `index.md`, `README.md`, then the only file. Otherwise pass `--entrypoint <path>`.",
        },
      ],
    },
  ],
};
