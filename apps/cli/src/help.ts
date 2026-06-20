export const HELP_TEXT = `agent-paste

Usage:
  agent-paste help publish
  agent-paste login
  agent-paste logout
  agent-paste whoami [--json]
  agent-paste publish <path> [--artifact-id <id>] [--title <text>] [--entrypoint <path>] [--render-mode <mode>] [--ephemeral] [--claim-code <clm_...>] [--json]
  agent-paste pull <artifact-id> <path> [--revision-id <id>] [--json]
  agent-paste edit <artifact-id> <path> [--edits <file>] [--json]
  agent-paste set-visibility <artifact-id> <private|unlisted> [--json]
  agent-paste version [--json]
  agent-paste upgrade [<tag>]

Agent publish quick path:
  1. Run agent-paste whoami --json.
     It exits 0 even when signed out; parse "authenticated": false.
  2. If authenticated, run agent-paste publish <path> --json.
  3. If the user needs a no-login link, run
     agent-paste set-visibility <artifact_id> unlisted --json and return unlisted_url.
  4. If not authenticated and login is not possible, run
     agent-paste publish <path> --ephemeral --json and return unlisted_url.
     If a copied prompt included --claim-code, preserve that flag. It carries
     claim-funnel attribution into unlisted_url and claim_url, not authorization.

Publish modes:
  Private   Default. agent-paste publish <path>. Returns private_url, a
            login-walled /v/<artifact_id> viewer. Not a share link.
  Unlisted  No-login handoff. Run set-visibility <id> unlisted after publish.
            Returns unlisted_url, the Artifact's revocable Share Link.
            Follows later publishes.
  Ephemeral Accountless publish for no-login environments. Return unlisted_url.
            Use claim_url only to keep, own, and unlock interactivity.

More help:
  agent-paste help publish    Mode choices, exact recipes, JSON fields.

Output:
  --json        Machine-readable JSON on stdout (stable, carries schema_version).
  --quiet       Suppress the human summary; errors and exit code still apply.
  --color       Force colour/rich output; --no-color forces plain.
                Default: rich on a TTY, plain when piped or NO_COLOR/CI is set.
`;

export const PUBLISH_HELP_TEXT = `agent-paste publish guide for agents

Use this as the decision prompt before publishing.

Choose the mode:
  Private
    When: workspace member only, draft handoff, or the user did not ask for
    no-login sharing.
    Run:  agent-paste publish <path> --json
    Use:  return private_url only when the recipient can log in.

  Unlisted
    When: the user asks to share, post, send a link, or make it reachable
    without login.
    Run:  agent-paste publish <path> --json
          agent-paste set-visibility <artifact_id> unlisted --json
    Use:  return unlisted_url. It is a revocable Share Link that follows later
          publishes.

  Ephemeral
    When: whoami --json says authenticated:false and interactive login is not
    possible, or the user explicitly asks for accountless publish.
    Run:  agent-paste publish <path> --ephemeral --json
          agent-paste publish <path> --ephemeral --claim-code <clm_...> --json
    Use:  return unlisted_url, not private_url. Also provide claim_url when the
          human wants to keep, own, or unlock interactivity. Unclaimed ephemeral
          HTML has scripts disabled, so do not use it for interactive JS apps.
    Note: --claim-code is optional public attribution. It is copied into
          unlisted_url and claim_url as claim_code; it is not a Claim Token,
          auth, ownership, billing, idempotency, or a secret.

Fast recipes:
  Authenticated private publish:
    agent-paste whoami --json
    agent-paste publish <path> --json

  Authenticated no-login handoff:
    agent-paste publish <path> --json
    agent-paste set-visibility <artifact_id> unlisted --json

  Make an Artifact private again:
    agent-paste set-visibility <artifact_id> private --json
    This revokes active Access Links and returns private_url.

  Revise existing Artifact:
    agent-paste publish <path> --artifact-id <artifact_id> --json
    Existing private_url and any active Share Link keep the same URL and show
    the latest Published Revision.

  Accountless handoff:
    agent-paste publish <path> --ephemeral --json
    Preserve --claim-code <clm_...> when copied instructions include it; the
    CLI carries it into unlisted_url and claim_url as claim_code.

What to hand back:
  private_url           Private viewer for signed-in Workspace Members.
  unlisted_url          No-login Share Link from set-visibility unlisted, or
                        from ephemeral publish when no login is available.
  claim_url             Ephemeral keep/upgrade link. Do not use as the primary
                        no-login viewing link.
  revision_content_url  Raw signed bytes for one Revision. Do not use as the
                        final live page.
  agent_view_url        Agent metadata and per-file signed URLs for inspection.

JSON fields:
  publish --json returns:
    { schema_version, artifact_id, revision_id, title, private_url,
      revision_content_url, agent_view_url, expires_at, bundle, upload_stats }

  set-visibility <id> unlisted --json returns:
    { schema_version, artifact_id, visibility, access_link_id, unlisted_url }

  set-visibility <id> private --json returns:
    { schema_version, artifact_id, visibility, private_url,
      revoked_access_link_ids }

  publish --ephemeral --json also returns:
    { unlisted_url, claim_token, claim_url, workspace_id, api_key_id,
      claim_token_id, claim_code? }

Path behavior:
  <path> may be a file or directory. Directory publish uploads every included
  file except .git, node_modules, .DS_Store, and .env*; relative paths are
  preserved, so the entrypoint can load sibling JS/CSS/JSON/assets. Entrypoint
  defaults to index.html, index.md, README.md, then the only file.
  --artifact-id Revise an EXISTING Artifact: publishes a new Revision under it
                instead of creating a new Artifact. The viewer link is stable and
                live-updates pages already open; this is how you change published
                work. On a revise the CLI sends only the files that changed (large
                text files as a diff), inheriting the rest, so a one-line edit is a
                small upload. Omit it to create a new Artifact on a new link.
                Re-publishing an edit without --artifact-id strands the user's link.
  --title       Set the Artifact title.
  --entrypoint  Override the entrypoint file within <path>.
  --render-mode html | markdown | text | image | audio | video (otherwise inferred from the entrypoint).
  --ephemeral   Accountless 24h publish with an immediate no-login unlisted_url
                and a one-time claim_url.
  --claim-code <clm_...>
                Optional analytics correlation ID for --ephemeral. Preserve it
                when a copied Agent Paste prompt includes one. The CLI carries
                it through to unlisted_url and claim_url as the public
                claim_code query parameter. It is not auth, ownership, billing,
                idempotency, a Claim Token, or a secret.

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
  fails loud; pull the file first to get the exact text. Editing reproduces the same
  {old_string, new_string} contract as the MCP multi_edit tool.

Set visibility:
  set-visibility private revokes active Access Links and returns private_url.
  set-visibility unlisted creates or reuses the Artifact's revocable Share Link
  and returns unlisted_url, a no-login signed URL that follows later publishes.
  Browser rendering for unlisted_url depends on the URL fragment; a plain HTTP
  fetch cannot verify the final rendered page.
`;
