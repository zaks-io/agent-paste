export const HELP_TEXT = `agent-paste

Usage:
  agent-paste login
  agent-paste logout
  agent-paste whoami [--json]
  agent-paste publish <path> [--artifact-id <id>] [--title <text>] [--entrypoint <path>] [--render-mode <mode>] [--ephemeral] [--json]
  agent-paste pull <artifact-id> <path> [--revision-id <id>] [--json]
  agent-paste edit <artifact-id> <path> [--edits <file>] [--json]
  agent-paste make-public <artifact-id> [--json]
  agent-paste version [--json]
  agent-paste upgrade [<tag>]

Publish:
  --artifact-id Revise an EXISTING Artifact: publishes a new Revision under it
                instead of creating a new Artifact. The viewer link is stable and
                live-updates pages already open — this is how you change published
                work. On a revise the CLI sends only the files that changed (large
                text files as a diff), inheriting the rest, so a one-line edit is a
                small upload. Omit it to create a new Artifact on a new link.
                Re-publishing an edit without --artifact-id strands the user's link.
  --title       Set the Artifact title.
  --entrypoint  Override the entrypoint file within <path>.
  --render-mode text | markdown | html (otherwise inferred from the entrypoint).
  --ephemeral   Accountless 24h publish with a one-time claim link (no login).

Pull:
  Read one file's stored content back (so you can edit it and revise). Prints the
  text body to stdout (cat-like); --json adds sha256/size/is_binary. Binary or
  oversize files have no inline body (fetch via the content URL). --revision-id
  reads a specific Revision instead of the latest.

Edit:
  Edit one stored file in place with literal find/replace, then publish the result
  as a new Revision under the same stable link (the open page live-updates). Reads a
  JSON array of edits from stdin, or from --edits <file>:
    [{ "old_string": "...", "new_string": "...", "replace_all": false }]
  Each old_string must match the current file exactly once (set "replace_all": true
  to change every occurrence); edits apply in order. A non-matching or ambiguous edit
  fails loud — pull the file first to get the exact text. Editing reproduces the same
  {old_string, new_string} contract as the MCP multi_edit tool.

Make public:
  Publish keeps an Artifact private (the link is a login-walled viewer). To make
  it reachable without login, run make-public <artifact-id>: it creates (or
  reuses) the Artifact's revocable Share Link and prints the public URL.

Output:
  --json        Machine-readable JSON on stdout (stable, carries schema_version).
  --quiet       Suppress the human summary; errors and exit code still apply.
  --color       Force colour/rich output; --no-color forces plain.
                Default: rich on a TTY, plain when piped or NO_COLOR/CI is set.
`;
