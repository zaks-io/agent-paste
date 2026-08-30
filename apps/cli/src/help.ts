export const HELP_TEXT = `agent-paste

Usage:
  agent-paste help publish
  agent-paste help pull
  agent-paste login
  agent-paste logout
  agent-paste whoami [--json]
  agent-paste publish <path> [--artifact-id <id>] [--title <text>] [--entrypoint <path>] [--render-mode <mode>] [--ephemeral] [--claim-code <clm_...>] [--json]
  agent-paste pull <artifact-id> <remote-path> [--revision-id <id>] [--json]
  agent-paste edit <artifact-id> <path> [--edits <file>] [--json]
  agent-paste version [--json]
  agent-paste upgrade [<tag>]

Agent publish quick path:
  1. Run agent-paste whoami --json.
     It exits 0 even when signed out; parse "authenticated": false.
  2. If authenticated, run agent-paste publish <path> --json and return url.
  3. If not authenticated and browser login is possible, run agent-paste login,
     then publish.
  4. If login is unavailable, or the user asks for accountless publish, run:
     agent-paste publish <path> --ephemeral --json
     Return url. Return claim_url too when the human wants to keep the upload.

Every publish returns one top-level Artifact URL. It opens without login and
stays stable when you revise the same Artifact with --artifact-id.

Output:
  --json        Machine-readable JSON on stdout (stable, carries schema_version).
  --quiet       Suppress the human summary; errors and exit code still apply.
  --color       Force colour/rich output; --no-color forces plain.
                Default: rich on a TTY, plain when piped or NO_COLOR/CI is set.
`;

export const PULL_HELP_TEXT = `agent-paste pull help

Read one remote file stored inside an Artifact. The file body is written to
stdout; <remote-path> is relative to the Artifact root, not a local destination.

Usage:
  agent-paste pull <artifact-id> <remote-path> [--revision-id <id>] [--json]

Recipes:
  Save a remote file locally:
    agent-paste pull <artifact-id> index.html > ./index.html

  Hash a remote file without saving it:
    agent-paste pull <artifact-id> index.html | shasum -a 256
`;

export const PUBLISH_HELP_TEXT = `agent-paste publish help

Start:
  Run agent-paste whoami --json before publishing.
  - authenticated:true: publish normally.
  - authenticated:false and browser login is possible: run agent-paste login,
    then publish.
  - authenticated:false and no login is available: use --ephemeral.

Recipes:
  Signed-in publish:
    agent-paste publish <path> --json

  Revise an existing Artifact at the same URL:
    agent-paste publish <path> --artifact-id <artifact_id> --json

  Accountless 24-hour publish:
    agent-paste publish <path> --ephemeral --json
    Add --claim-code <clm_...> only when copied instructions include it.

What to hand back:
  url        Top-level Artifact capability URL. It opens without login.
  claim_url  Ephemeral keep/claim link. Include it when the human wants to keep
             or claim the upload.

JSON fields:
  publish --json returns:
    { schema_version, artifact_id, revision_id, title, url, expires_at,
      upload_stats }

  publish --ephemeral --json also returns:
    { claim_token, claim_url, workspace_id, api_key_id, claim_token_id }

Path behavior:
  <path> may be a file or directory. Directory publish uploads every included
  file except .git, node_modules, .DS_Store, and .env*. Symlinks are followed
  only when their target stays inside the published directory and is not an
  excluded path. Relative paths are preserved, so the entrypoint can load
  sibling JS, CSS, JSON, and assets. Entrypoint defaults to index.html,
  index.md, README.md, then the only file. A multi-file directory without an
  inferred entrypoint fails; pass --entrypoint <path>.

  --artifact-id Revise an EXISTING Artifact. The same url shows the newest
                Published Revision on refresh.
  --title       Set the Artifact title.
  --entrypoint  Override the entrypoint file within <path>.
  --render-mode html | markdown | text | image | audio | video
  --ephemeral   Accountless 24-hour publish with the same top-level page behavior
                and a one-time claim_url.
  --claim-code  Optional attribution for --ephemeral. Preserve it when copied
                Agent Paste instructions include one.
`;
