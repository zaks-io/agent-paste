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
            ["`agent-paste login`", "Authenticate through the browser."],
            ["`agent-paste login --device-code`", "Authenticate from a sandbox; approve in your own browser."],
            ["`agent-paste logout`", "Revoke and remove the stored credential."],
            ["`agent-paste whoami --json`", "Report authentication, Workspace, actor, and scopes."],
            ["`agent-paste publish <path>`", "Publish a file or folder and return `url`."],
            ["`agent-paste pull <artifact-id> <path>`", "Read one stored file."],
            ["`agent-paste edit <artifact-id> <path>`", "Apply literal edits and publish a Revision."],
            ["`agent-paste version`", "Print the CLI version."],
            ["`agent-paste upgrade`", "Update a standalone binary install."],
          ],
        },
        {
          kind: "paragraph",
          text: "`--json` writes one object to stdout with `schema_version`; progress and errors go to stderr. Exit codes: 0 success, 1 generic, 2 authentication, 3 quota, 4 validation, 5 not found, 6 network or server. `agent-paste help publish` and `help pull` list flags and JSON fields.",
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
          text: "`whoami` exits 0 even when signed out, so check `authenticated`. Device login prints a URL and code on stderr and needs network access to WorkOS and the API but no local browser. Keep it running until the user approves, then run `whoami` again. An `AGENT_PASTE_API_KEY` env var also authenticates and takes precedence over stored credentials.",
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
          code: "agent-paste publish ./report --json\nagent-paste publish ./report --artifact-id 01234-56789-abcde-fghjd --json",
        },
        {
          kind: "paragraph",
          text: "The returned `url` opens without login and stays the same across updates. Its artifact ID is the first label of the hostname; `--artifact-id`, `pull`, and `edit` accept that ID, the `art_...` `artifact_id` from JSON output, or the full URL. Updates require Workspace access.",
        },
        {
          kind: "code",
          language: "text",
          code: '✓ Published "report"\n\n  View      https://01234-56789-abcde-fghjd.agent-paste.link/\n  Expires   <expiration date>\n\n  Update    agent-paste publish ./report --artifact-id 01234-56789-abcde-fghjd\n\n  → open https://01234-56789-abcde-fghjd.agent-paste.link/',
        },
        {
          kind: "paragraph",
          text: "When login is unavailable, `publish <path> --ephemeral --json` publishes without an account. See [Ephemeral](/docs/ephemeral).",
        },
      ],
    },
    {
      id: "paths",
      title: "Files and entrypoints",
      blocks: [
        {
          kind: "paragraph",
          text: "Directory publish keeps relative paths and skips `.git`, `node_modules`, `.DS_Store`, and `.env*`. The entrypoint is `index.html`, `index.md`, `README.md`, or the only file; otherwise pass `--entrypoint <path>`. Pass `--render-mode html|markdown|text|image|audio|video` only when inference is wrong.",
        },
      ],
    },
  ],
};
