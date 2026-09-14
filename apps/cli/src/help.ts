export const HELP_TEXT = `agent-paste

Usage:
  agent-paste help publish
  agent-paste help pull
  agent-paste login [--device-code]
  agent-paste logout
  agent-paste whoami [--json]
  agent-paste publish <path> [--artifact-id <artifact-id>] [--title <text>] [--entrypoint <path>] [--render-mode <mode>] [--ephemeral] [--claim-code <clm_...>] [--json]
  agent-paste pull <artifact-id> <remote-path> [--revision-id <id>] [--json]
  agent-paste edit <artifact-id> <path> [--edits <file>] [--json]
  agent-paste version [--json]
  agent-paste upgrade [<tag>]

Agent quick path:
  1. agent-paste whoami --json. Exits 0 even when signed out; check "authenticated".
  2. If false: agent-paste login (browser available) or agent-paste login --device-code
     (sandbox). Device login prints a URL and code on stderr; keep it running
     until the user approves, then run whoami again.
  3. agent-paste publish <path> --json. Return url.
  4. No login available: agent-paste publish <path> --ephemeral --json.
     Return claim_url too when the user wants to keep it.

Every publish returns one URL that opens without login and stays the same
across updates. Its artifact ID is the first label of the hostname; --artifact-id,
pull, and edit accept the ID or the full URL.

Output:
  --json        One machine-readable object on stdout, with schema_version.
  --quiet       Suppress the human summary; errors and exit code still apply.
  --color       Force rich output; --no-color forces plain.
                Default: rich on a TTY, plain when piped or NO_COLOR/CI is set.
`;

export const PULL_HELP_TEXT = `agent-paste pull help

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

Start with agent-paste whoami --json. It exits 0 even when signed out; if
"authenticated" is false, run agent-paste login (browser available) or
agent-paste login --device-code (sandbox), approve the URL and code it prints
on stderr, then run whoami again.

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
      upload_stats }

  publish --ephemeral --json also returns:
    { claim_token, claim_url, workspace_id, api_key_id, claim_token_id }

Path behavior:
  <path> may be a file or directory. Directory publish keeps relative paths and
  skips .git, node_modules, .DS_Store, and .env*. Symlinks are followed only
  when the target stays inside the directory and is not an excluded path. The
  entrypoint is index.html, index.md, README.md, or the only file; any other
  multi-file directory needs --entrypoint <path>.

Flags:
  --artifact-id Revise an existing Artifact. Accepts the ID or the full URL.
  --title       Set the Artifact title.
  --entrypoint  Entrypoint file within <path>.
  --render-mode html | markdown | text | image | audio | video
  --ephemeral   Accountless 24-hour publish. Static until claimed via claim_url.
  --claim-code  Attribution for --ephemeral. Keep it when the user's
                instructions include one.
`;
