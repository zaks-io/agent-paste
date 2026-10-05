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
            ["`agent-paste logout`", "Attempt to revoke and remove the saved login credential."],
            ["`agent-paste whoami --json`", "Report authentication, Workspace, actor, and scopes."],
            ["`agent-paste publish <path>`", "Publish a file or folder and return `url`."],
            ["`agent-paste pull <artifact-id> <path>`", "Read one stored file."],
            ["`agent-paste edit <artifact-id> <path>`", "Apply literal edits and publish a Revision."],
            ["`agent-paste download <artifact-id>`", "Save a Revision as a zip."],
            ["`agent-paste version`", "Print the CLI version."],
            ["`agent-paste upgrade`", "Update a standalone binary install."],
          ],
        },
        {
          kind: "paragraph",
          text: "`--json` writes one object to stdout with `schema_version`; progress and errors go to stderr. Exit codes: 0 success, 1 generic or transport failure, 2 authentication, 3 quota, 4 validation, 5 not found, 6 HTTP server failure. `agent-paste help publish` and `help pull` list flags and JSON fields.",
        },
      ],
    },
    {
      id: "api-keys",
      title: "API keys for CI and headless agents",
      blocks: [
        {
          kind: "paragraph",
          text: "Create a key at [API Keys](https://app.agent-paste.sh/keys). Its secret is shown once. Inject it securely as `AGENT_PASTE_API_KEY` through your sandbox or CI secret configuration. An already injected key authenticates automatically, with no login. Keep the inherited environment; never print the key or pass it as a command argument.",
        },
        {
          kind: "code",
          language: "sh",
          code: "agent-paste whoami --json\nagent-paste publish ./report --json",
        },
        {
          kind: "paragraph",
          text: "A non-empty `AGENT_PASTE_API_KEY` takes precedence over saved login. Invalid, revoked, expired, or wrong-environment keys fail with exit 2; the CLI does not try saved credentials. Correct or remove the environment key before retrying. `whoami` exits 0 with `authenticated: false` only when no usable local credential exists. A successful response identifies the Workspace, actor, and scopes. CLI 0.2.6 and later add `authenticated: true`; 0.2.5 and earlier omit it on success. HTTP server failures exit 6; transport failures exit 1.",
        },
        {
          kind: "paragraph",
          text: "`logout` attempts to revoke the saved login credential, then removes it locally and reports any remote revocation failure. It leaves the environment key untouched, so that key can still authenticate. Revoke environment keys in the dashboard and remove them from secret configuration when no longer needed.",
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
          code: "agent-paste login --device-code\nagent-paste whoami --json",
        },
        {
          kind: "paragraph",
          text: "Use login only when `whoami --json` reports `authenticated: false`. Run `login` with a browser on the same machine, or `login --device-code` in a sandbox or SSH session. Device login prints a URL and code on stderr and needs network access to WorkOS and the API but no local browser. Keep it running until the user approves, then check `whoami` again.",
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
          text: "The returned `url` opens without login and stays the same across updates. Its artifact ID is the first label of the hostname; `--artifact-id`, `pull`, `edit`, and `download` accept that ID, the `art_...` `artifact_id` from JSON output, or the full URL. Updates require Workspace access.",
        },
        {
          kind: "code",
          language: "text",
          code: '✓ Published "report"\n\n  View      https://01234-56789-abcde-fghjd.agent-paste.link/\n  Expires   <expiration date>\n\n  Update    agent-paste publish ./report --artifact-id 01234-56789-abcde-fghjd\n\n  → open https://01234-56789-abcde-fghjd.agent-paste.link/',
        },
        {
          kind: "paragraph",
          text: "Use `publish <path> --ephemeral --json` when no authenticated path is available and static output meets the task, or the user requests accountless publishing. It explicitly ignores both environment and saved credentials. Do not use it automatically after an authentication failure. See [Ephemeral](/docs/ephemeral).",
        },
      ],
    },
    {
      id: "paths",
      title: "Files and entrypoints",
      blocks: [
        {
          kind: "paragraph",
          text: "Directory publish keeps relative paths and skips `.git`, `node_modules`, `.DS_Store`, and `.env*`. The entrypoint is `index.html`, `index.md`, `README.md`, or the only file; otherwise pass `--entrypoint <path>`.",
        },
      ],
    },
  ],
};
