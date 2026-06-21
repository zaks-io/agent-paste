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
  2. If authenticated, run agent-paste publish <path> --json and return private_url.
  3. If not authenticated and browser login is possible, run agent-paste login.
     It opens OAuth in the user's browser. Then publish.
  4. If a signed-in publish needs a no-login link, use artifact_id from publish:
     agent-paste set-visibility <artifact_id> unlisted --json
     Return unlisted_url.
  5. If no login is available, or the user asks for accountless publish, run:
     agent-paste publish <path> --ephemeral --json
     Return unlisted_url. Return claim_url too when the human wants to keep or claim it.
     Preserve --claim-code <clm_...> when copied instructions include it; it is
     for attribution and claim links.

Publish modes:
  Private   Default signed-in publish. Returns private_url in the user's
            Workspace. This is not a no-login link.
  Unlisted  Signed-in no-login sharing. Run set-visibility <id> unlisted after
            publish. Returns unlisted_url, a revocable Share Link that follows
            later publishes.
  Ephemeral Accountless 24h publish when login is unavailable. Returns
            unlisted_url and claim_url. Unclaimed HTML is script-disabled.

More help:
  agent-paste help publish    Mode choices, exact recipes, JSON fields.

Output:
  --json        Machine-readable JSON on stdout (stable, carries schema_version).
  --quiet       Suppress the human summary; errors and exit code still apply.
  --color       Force colour/rich output; --no-color forces plain.
                Default: rich on a TTY, plain when piped or NO_COLOR/CI is set.
`;

export const PUBLISH_HELP_TEXT = `agent-paste publish help

Start:
  Run agent-paste whoami --json before publishing.
  - authenticated:true: publish normally.
  - authenticated:false and browser login is possible: run agent-paste login.
    It opens OAuth in the user's browser. Then publish.
  - authenticated:false and no login is available: use --ephemeral.

Modes:
  Signed-in private
    When: default; the user did not ask for a no-login link.
    Run:  agent-paste publish <path> --json
    Return: private_url.

  Signed-in no-login
    When: the user asks to share, post, send a link, make it unlisted, or make
    it reachable without login.
    Run:  agent-paste publish <path> --json
          agent-paste set-visibility <artifact_id> unlisted --json
    Use:  artifact_id from the publish JSON.
    Return: unlisted_url.

  Accountless 24h
    When: no login is available, or the user explicitly asks for accountless
    publish.
    Run:  agent-paste publish <path> --ephemeral --json
          agent-paste publish <path> --ephemeral --claim-code <clm_...> --json
    Return: unlisted_url. Return claim_url too when the human wants to keep or
    claim it. Unclaimed HTML is script-disabled; use signed-in publish for
    interactive JS.
    Note: preserve --claim-code only when copied instructions include it. It is
    for attribution and claim links.

Recipes:
  Signed-in private publish:
    agent-paste whoami --json
    agent-paste publish <path> --json

  Signed-in no-login link:
    agent-paste publish <path> --json
    agent-paste set-visibility <artifact_id> unlisted --json

  Make an Artifact private again:
    agent-paste set-visibility <artifact_id> private --json
    This revokes active Access Links and returns private_url.

  Revise existing Artifact:
    agent-paste publish <path> --artifact-id <artifact_id> --json
    Existing private_url and any active Share Link keep the same URL and show
    the latest Published Revision.

  Accountless publish:
    agent-paste publish <path> --ephemeral --json
    Add --claim-code <clm_...> only when copied instructions include it.

What to hand back:
  private_url           Default signed-in viewer.
  unlisted_url          No-login Share Link from set-visibility unlisted, or
                        from ephemeral publish when no login is available.
  claim_url             Ephemeral keep/claim link. Return it with ephemeral
                        output when the human wants to keep the upload.
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
      claim_token_id }

Path behavior:
  <path> may be a file or directory. Directory publish uploads every included
  file except .git, node_modules, .DS_Store, and .env*; relative paths are
  preserved, so the entrypoint can load sibling JS/CSS/JSON/assets. Entrypoint
  defaults to index.html, index.md, README.md, then the only file.
  --artifact-id Revise an EXISTING Artifact: publishes a new Revision under it
                instead of creating a new Artifact. Existing links stay stable.
                Omit it to create a new Artifact on a new link.
  --title       Set the Artifact title.
  --entrypoint  Override the entrypoint file within <path>.
  --render-mode html | markdown | text | image | audio | video (otherwise inferred from the entrypoint).
  --ephemeral   Accountless 24h publish with an immediate no-login unlisted_url
                and a one-time claim_url.
  --claim-code <clm_...>
                Optional attribution for --ephemeral. Preserve it when copied
                Agent Paste instructions include one.

Set visibility:
  set-visibility private revokes active Access Links and returns private_url.
  set-visibility unlisted creates or reuses the Artifact's revocable Share Link
  and returns unlisted_url, a no-login signed URL that follows later publishes.
  Browser rendering for unlisted_url depends on the URL fragment; a plain HTTP
  fetch cannot verify the final rendered page.
`;
