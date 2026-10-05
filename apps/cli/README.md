# @zaks-io/agent-paste

Publish a file or folder to its own website:

```sh
npx @zaks-io/agent-paste publish ./report
```

```text
✓ Published "report"

  View      https://01234-56789-abcde-fghjd.agent-paste.link/
  Expires   <expiration date>
  Upload    3/3 uploaded, 0 reused · 42 KB sent, 0 B cached

  Update    npx @zaks-io/agent-paste publish ./report --artifact-id 01234-56789-abcde-fghjd
            (revises this Artifact; the same link shows the latest revision)

  → open https://01234-56789-abcde-fghjd.agent-paste.link/
```

The URL opens without login and stays the same across updates. Its artifact ID
is the first label of the hostname; `--artifact-id`, `pull`, and `edit` accept
that ID, the `art_...` `artifact_id` from JSON output, or the full URL. Updates require Workspace access.

The npm package requires Node.js 24. Without a global install, prefix commands
with `npx @zaks-io/agent-paste`.

## Agent quick path

```sh
agent-paste whoami --json
agent-paste publish <path> --json
```

`whoami` exits 0 with `authenticated: false` when no usable local credential
exists. A successful response includes Workspace, actor, and scopes. CLI 0.2.6
and later also return `authenticated: true`; 0.2.5 and earlier omit it on success.
Publish without another login after a successful response.
API authentication failures exit 2; HTTP server failures exit 6; transport failures exit 1.

## Authentication

For CI, sandboxes, and headless agents, create a key at
[API Keys](https://app.agent-paste.sh/keys). Its secret is shown once. Inject it
securely as `AGENT_PASTE_API_KEY` through your CI or sandbox secret configuration.
An already injected key needs no login. Keep the inherited environment and do
not print the key or put it in command arguments.

A non-empty `AGENT_PASTE_API_KEY` takes precedence over a saved login credential.
An invalid, revoked, expired, or wrong-environment key fails with exit 2; the CLI
does not fall back to saved login. Correct or remove that environment key before
trying saved credentials or logging in.

Without a usable credential, run `agent-paste login` where a browser is
available. In a sandbox or SSH session, run `agent-paste login --device-code`.
It prints a URL and code on stderr, and needs network access to WorkOS and the
API but no local browser. Keep it running until the user approves, then check
`whoami` again.

`logout` attempts to revoke the saved login credential, then removes it locally.
It reports a failed remote revocation. It leaves `AGENT_PASTE_API_KEY` untouched,
so that key can still authenticate. Revoke environment keys in the dashboard and
remove them from your secret configuration when they are no longer needed.

Use accountless publishing when no authenticated path is available and static
output meets the task, or when the user asks for it. `--ephemeral` explicitly
ignores both the environment key and saved login. It is not an automatic fallback
for an authentication failure:

```sh
agent-paste publish <path> --ephemeral --json
```

Return `url`. Ephemeral output also has `claim_url` for the optional keep step.

## Commands

| Command                                                  | Purpose                                                  |
| -------------------------------------------------------- | -------------------------------------------------------- |
| `agent-paste login`                                      | Authenticate through the browser.                        |
| `agent-paste login --device-code`                        | Authenticate from a sandbox or remote shell.             |
| `agent-paste logout`                                     | Attempt to revoke and remove the saved login credential. |
| `agent-paste whoami --json`                              | Report authentication, Workspace, actor, and scopes.     |
| `agent-paste publish <path>`                             | Publish a new Artifact.                                  |
| `agent-paste publish <path> --artifact-id <artifact-id>` | Revise an Artifact at the same URL.                      |
| `agent-paste publish <path> --ephemeral`                 | Accountless 24-hour publish.                             |
| `agent-paste pull <artifact-id> <remote-path>`           | Read one stored file.                                    |
| `agent-paste edit <artifact-id> <path> --edits <file>`   | Apply literal edits and publish a Revision.              |
| `agent-paste download <artifact-id> [--output <file>]`   | Save a Revision as a zip.                                |
| `agent-paste version`                                    | Print the installed version.                             |
| `agent-paste upgrade`                                    | Install a release tag (standalone binary).               |

`agent-paste help publish` and `agent-paste help pull` cover flags, JSON
fields, and recipes.

## Publish JSON

`publish --json` writes one object to stdout:

```json
{
  "schema_version": "2",
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "title": "report",
  "url": "https://01234-56789-abcde-fghjd.agent-paste.link/",
  "expires_at": "<ISO 8601 expiration timestamp>",
  "upload_stats": {
    "total_files": 3,
    "total_bytes": 43008,
    "uploaded_files": 3,
    "uploaded_bytes": 43008,
    "reused_files": 0,
    "reused_bytes": 0
  }
}
```

`publish --ephemeral --json` also includes `claim_token`, `claim_url`,
`workspace_id`, `api_key_id`, and `claim_token_id`.

Version 0.2 removed `set-visibility` and replaced `private_url` and
`unlisted_url` with `url`.

## Files and entrypoints

`<path>` may be a file or a directory. Directory publish keeps relative paths
and skips `.git`, `node_modules`, `.DS_Store`, and `.env*`. Symlinks are
followed only when the target stays inside the directory and is not an excluded
path.

The entrypoint is `index.html`, `index.md`, `README.md`, or the only file. Any
other multi-file directory needs `--entrypoint <path>`.

## Output and exit behavior

`--json` reserves stdout for one object; progress and errors go to stderr.
`--quiet` suppresses the human summary. `--color` and `--no-color` override TTY
detection.

Exit codes: `0` success, `1` generic, `2` authentication, `3` quota, `4`
validation, `5` not found, `6` HTTP server failure. Transport failures use `1`.

The package bundles its JavaScript into `dist/index.js`. npm installs the
matching platform-native filesystem helper for root-bounded local reads.
