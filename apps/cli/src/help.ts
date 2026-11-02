export const HELP_TEXT = `agent-paste

Usage:
  agent-paste help publish
  agent-paste help pull
  agent-paste login [--device-code]
  agent-paste logout
  agent-paste whoami [--json]
  agent-paste feedback [<body>] [--json]
  agent-paste publish <path> [--artifact-id <artifact-id>] [--title <text>] [--entrypoint <path>] [--ephemeral] [--claim-code <clm_...>] [--json]
  agent-paste pull <artifact-id> <remote-path> [--revision-id <id>] [--json]
  agent-paste pull <artifact-id> [<remote-path>...] --output <dir> [--overwrite] [--dry-run] [--json]
  agent-paste edit <artifact-id> <path> [--edits <file>] [--json]
  agent-paste download <artifact-id> [--revision-id <id>] [--output <path>] [--json]
  agent-paste pin <artifact-id> [--json]
  agent-paste unpin <artifact-id> [--json]
  agent-paste list [--cursor <cursor>] [--json]
  agent-paste usage [--json]
  agent-paste delete <artifact-id> --yes [--json]
  agent-paste version [--json]
  agent-paste upgrade [<tag>]

Authentication:
  AGENT_PASTE_API_KEY authenticates without login and overrides saved login.
  Create a key at https://app.agent-paste.sh/keys and inject it through secret
  configuration. Keep inherited sandbox credentials; never print the key.
  A rejected key fails with exit 2; it does not fall back to saved login.
  logout revokes/removes saved login only; the environment key stays active.

Agent quick path:
  1. agent-paste whoami --json. If authenticated, publish directly.
     Exits 0 with "authenticated": false only when no usable local credential
     exists. API errors fail the command.
  2. If false: supply AGENT_PASTE_API_KEY, or agent-paste login (local browser)
     or agent-paste login --device-code (sandbox). Keep device login running
     until the user approves its URL/code on stderr, then run whoami again.
  3. agent-paste publish <path> --json. Return url.
  4. Authentication unavailable or accountless output requested:
     agent-paste publish <path> --ephemeral --json. Ignores existing credentials.
     Return claim_url too when the user wants to keep it.

Every publish returns one URL that opens without login and stays the same
across updates. Its artifact ID is the first label of the hostname; --artifact-id,
pull, edit, and download accept that ID, the art_... artifact_id from --json, or the full URL.

Output:
  --json        One machine-readable object on stdout, with schema_version.
  --quiet       Suppress the human summary; errors and exit code still apply.
  --color       Force rich output; --no-color forces plain.
                Default: rich on a TTY, plain when piped or NO_COLOR/CI is set.
`;

export const PULL_HELP_TEXT = `agent-paste pull help

Use --output <dir> to download a whole tree, files or prefixes with hash checking
and resumable partial files. Differing local files require --overwrite.
--dry-run lists files and conflicts without writing. Unselected local paths stay.

Read one file stored in an Artifact. <remote-path> is relative to the Artifact
root. Plain mode writes the text body to stdout. --json writes metadata and a
content URL; binary or oversized files omit body and are fetched from that URL.

Usage:
  agent-paste pull <artifact-id> <remote-path> [--revision-id <id>] [--json]

Recipes:
  agent-paste pull 01234-56789-abcde-fghjd index.html > ./index.html
  agent-paste pull 01234-56789-abcde-fghjd index.html | shasum -a 256
`;

export const PUBLISH_HELP_TEXT = `agent-paste publish help

Start with agent-paste whoami --json in the inherited environment.
AGENT_PASTE_API_KEY authenticates without login and overrides saved login.
If authenticated, publish directly. A rejected key fails with exit 2; fix the
key configuration rather than silently falling back to login or --ephemeral.
If it exits 0 with "authenticated": false, supply an API key or run
agent-paste login (local browser) or agent-paste login --device-code (sandbox).
Keep device login running for approval of its URL/code on stderr, then check
whoami again. Create API keys at https://app.agent-paste.sh/keys and inject
through secret configuration; never print them.

Recipes:
  agent-paste publish <path> --json
  agent-paste publish <path> --artifact-id 01234-56789-abcde-fghjd --json   # revise, same URL
  agent-paste publish <path> --ephemeral --json                              # no login, 24 hours

What to hand back:
  url        The Artifact. Opens without login.
  claim_url  Ephemeral only. Include it when the user wants to keep the upload.

JSON fields:
  publish --json returns:
    { schema_version, artifact_id, revision_id, title, url, expires_at,
      mode, no_change, retention, effective_expires_at, changes, upload_stats }

  publish --ephemeral --json also returns:
    { claim_token, claim_url, workspace_id, api_key_id, claim_token_id }

Limits and sync:
  Claimed: 250 MiB per file, 10,000 files / 2 GiB per Revision, subject to storage budget.
  Ephemeral: 10 MiB per file, 100 files / 25 MiB per Revision.
  Full publish with --artifact-id mirrors the tree and removes remote-only paths.
  --to preserves omitted paths; --mirror scopes deletions to its prefix.
  Rerun interrupted commands to resume. Conflicts require re-reading the head.
  Unchanged publishes create no Revision. Use pin/unpin/list/usage to manage hosting.

Path behavior:
  <path> may be a file or directory. Directory publish keeps relative paths and
  skips .git, node_modules, .DS_Store, and .env*. Symlinks are followed only
  when the target stays inside the directory and is not an excluded path. The
  entrypoint is index.html, index.md, README.md, or the only file; any other
  multi-file directory needs --entrypoint <path>.

Flags:
  --to          Upsert a remote file or directory prefix, preserving omitted files.
  --mirror      With --to, remove remote-only files inside the directory prefix.
  --delete      Delete an explicit remote file or prefix. Repeatable; requires --artifact-id.
                With a local path, also pass --to.
  --exclude     Exclude a local relative path glob. Repeatable. Mirrors delete excluded paths.
  --pin         Pin with publish. No scheduled expiry, subject to deletion and policy.
  --dry-run     Show changes, guards, byte maximum, limits and usage without uploading.
  --artifact-id Revise an existing Artifact. Accepts the ID or the full URL.
  --title       Set the Artifact title.
  --entrypoint  Entrypoint file within <path>.
  --ephemeral   Accountless 24-hour publish. Ignores environment/saved credentials.
                Static until claimed via claim_url.
  --claim-code  Attribution for --ephemeral. Keep it when the user's
                instructions include one.
`;
