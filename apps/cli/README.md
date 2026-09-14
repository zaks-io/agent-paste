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

`whoami` exits 0 even when signed out, so check `authenticated` in its JSON.
If false, run `agent-paste login` where a browser is available. In a sandbox or
SSH session, run `agent-paste login --device-code`: it prints a URL and code on
stderr, and needs network access to WorkOS and the API but no local browser.
Keep it running until the user approves, then run `whoami` again. An
`AGENT_PASTE_API_KEY` env var also authenticates and takes precedence over
stored credentials.

When login is unavailable, or the user asks for accountless publishing:

```sh
agent-paste publish <path> --ephemeral --json
```

Return `url`. Ephemeral output also has `claim_url` for the optional keep step.

## Commands

| Command                                                  | Purpose                                              |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `agent-paste login`                                      | Authenticate through the browser.                    |
| `agent-paste login --device-code`                        | Authenticate from a sandbox or remote shell.         |
| `agent-paste logout`                                     | Remove the stored credential.                        |
| `agent-paste whoami --json`                              | Report authentication, Workspace, actor, and scopes. |
| `agent-paste publish <path>`                             | Publish a new Artifact.                              |
| `agent-paste publish <path> --artifact-id <artifact-id>` | Revise an Artifact at the same URL.                  |
| `agent-paste publish <path> --ephemeral`                 | Accountless 24-hour publish.                         |
| `agent-paste pull <artifact-id> <remote-path>`           | Read one stored file.                                |
| `agent-paste edit <artifact-id> <path> --edits <file>`   | Apply literal edits and publish a Revision.          |
| `agent-paste version`                                    | Print the installed version.                         |
| `agent-paste upgrade`                                    | Install a release tag (standalone binary).           |

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
other multi-file directory needs `--entrypoint <path>`. Pass
`--render-mode html|markdown|text|image|audio|video` only when inference is
wrong.

## Output and exit behavior

`--json` reserves stdout for one object; progress and errors go to stderr.
`--quiet` suppresses the human summary. `--color` and `--no-color` override TTY
detection.

Exit codes: `0` success, `1` generic, `2` authentication, `3` quota, `4`
validation, `5` not found, `6` network or server failure.

The package bundles its application code into `dist/index.js` with one pinned
runtime dependency, `@openclaw/fs-safe`, for root-bounded local reads.
