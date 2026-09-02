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

  Update    npx @zaks-io/agent-paste publish ./report --artifact-id art_01H...
            (revises this Artifact; the same link shows the latest revision)

  → open https://01234-56789-abcde-fghjd.agent-paste.link/
```

The returned URL opens top-level without login. There is no iframe, viewer
wrapper, or visibility command. Revising with `--artifact-id` keeps the URL and
updates the website shown there.

## Migrating to 0.2

Version 0.2 removes `set-visibility` and replaces `private_url` and
`unlisted_url` with one `url` field. JSON output uses `schema_version: "2"`.

## Agent quick path

```sh
agent-paste whoami --json
agent-paste publish <path> --json
```

`whoami` exits `0` when signed out, so inspect `authenticated` in its JSON. Run
`agent-paste login` when browser login is possible. Use accountless publish only
when login is unavailable or explicitly requested:

```sh
agent-paste publish <path> --ephemeral --json
```

Return `url` to the user. Ephemeral output also contains `claim_url` for the
optional keep and ownership step.

## Commands

| Command                                                | Purpose                                              |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `agent-paste login`                                    | Authenticate through browser PKCE.                   |
| `agent-paste logout`                                   | Remove the stored CLI session.                       |
| `agent-paste whoami --json`                            | Report authentication, Workspace, actor, and scopes. |
| `agent-paste publish <path>`                           | Publish a new Artifact website.                      |
| `agent-paste publish <path> --artifact-id <id>`        | Revise an Artifact at the same URL.                  |
| `agent-paste publish <path> --ephemeral`               | Accountless 24-hour publish.                         |
| `agent-paste pull <artifact-id> <remote-path>`         | Read one file; see pull help for output and URLs.    |
| `agent-paste edit <artifact-id> <path> --edits <file>` | Apply literal edits and publish a Revision.          |
| `agent-paste version`                                  | Print the installed version.                         |
| `agent-paste upgrade`                                  | Install a selected release tag.                      |

Run `agent-paste help publish` for the full agent-oriented publish guide.
Run `agent-paste help pull` for remote-path and local redirection examples.

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

## Files and entrypoints

`<path>` may be one file or a directory. Directory publishing preserves relative
paths and skips `.git`, `node_modules`, `.DS_Store`, `.env`, and `.env.*`.
Symlinks are followed only when the resolved target stays inside the published
directory and does not cross an excluded path.

The CLI selects `index.html`, `index.md`, `README.md`, or the only file as the
entrypoint. For any other multi-file directory, pass `--entrypoint <path>`.

Use `--render-mode html|markdown|text|image|audio|video` only when inference is
not correct.

## Output and exit behavior

`--json` reserves stdout for one machine-readable object. Progress and errors go
to stderr. `--quiet` suppresses human success output. `--color` and `--no-color`
override TTY detection.

Exit codes are `0` success, `1` generic, `2` authentication, `3` quota,
`4` validation, `5` not found, `6` conflict, and `7` unavailable.

The package has zero runtime dependencies. It is bundled into the published
`dist/index.js`.
