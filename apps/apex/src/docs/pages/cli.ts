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
            ["`agent-paste help publish`", "Agent-oriented publish guide with mode choices, recipes, and JSON fields."],
            ["`agent-paste login`", "Sign in through browser OAuth and store a scoped local credential."],
            ["`agent-paste logout`", "Revoke the stored credential when possible, then remove it locally."],
            ["`agent-paste whoami`", "Show the resolved Workspace, actor, and granted scopes."],
            [
              "`agent-paste publish <path>`",
              "Upload files, publish a Revision, and print the result. Content-only and private.",
            ],
            ["`agent-paste pull <artifact-id> <path>`", "Read one stored file's content back from an Artifact."],
            [
              "`agent-paste edit <artifact-id> <path>`",
              "Apply literal find/replace edits to one stored file, then publish a new Revision under the same link.",
            ],
            [
              "`agent-paste set-visibility <artifact-id> <private|unlisted>`",
              "Change visibility. `unlisted` returns `unlisted_url`; `private` revokes active Access Links.",
            ],
            ["`agent-paste version`", "Print the CLI version baked into the package or binary."],
            ["`agent-paste upgrade [<tag>]`", "Self-update a standalone binary install."],
          ],
        },
      ],
    },
    {
      id: "auth-checks",
      title: "Auth checks",
      blocks: [
        {
          kind: "paragraph",
          text: "`agent-paste whoami` answers the auth state query. It exits `0` when signed out because the command ran successfully and returned a valid signed-out state. Agents and scripts should use `agent-paste whoami --json` and branch on `authenticated`, not on the process exit code.",
        },
      ],
    },
    {
      id: "flags",
      title: "Publish flags",
      blocks: [
        {
          kind: "table",
          columns: ["Flag", "Purpose"],
          rows: [
            ["`--artifact-id <id>`", "Publish a new Revision of an existing Artifact."],
            [
              "`--title <text>`",
              "Set the display title. New Artifacts default to the file or folder name; revisions preserve the existing title unless this is explicit.",
            ],
            ["`--entrypoint <path>`", "Choose the file opened first by viewers."],
            [
              "`--render-mode <mode>`",
              "Override inferred mode: `html`, `markdown`, `text`, `image`, `audio`, or `video`.",
            ],
            [
              "`--ephemeral`",
              "Restricted accountless fallback for non-interactive text/images/static output. Ignores stored login, disables scripts while unclaimed, and prints `unlisted_url` plus `claim_url`.",
            ],
            [
              "`--claim-code <clm_...>`",
              "Optional public attribution for `--ephemeral`. Preserve it when copied instructions include one; the CLI carries it into `unlisted_url` and `claim_url` as `claim_code`.",
            ],
            ["`--revision-id <id>`", "With `pull`, read a specific Revision instead of the latest Published Revision."],
            ["`--edits <file>`", "With `edit`, read the JSON edit array from a file instead of stdin."],
            ["`--json`", "Emit pure JSON on stdout. Errors still go to stderr."],
            ["`--quiet`", "Suppress human-readable stdout."],
            ["`--color` / `--no-color`", "Force rich or plain output. Default: rich on a TTY, plain when piped."],
          ],
        },
      ],
    },
    {
      id: "output",
      title: "Output",
      blocks: [
        {
          kind: "paragraph",
          text: "Publish is content-only and private. A successful CLI publish leads with `View`, the `private_url` (`/v/<artifactId>` clean viewer for the Workspace Member), then an `Update` line: the one command to revise this Artifact in place (`publish <path> --artifact-id art_...`). The `Update` line is the explicit revise handle on the human surface — Revision IDs, `revision_content_url`, and `agent_view_url` stay in the JSON output. Revising keeps the same link and live-updates pages already open; publishing again without the id makes a new Artifact on a new link.",
        },
        {
          kind: "code",
          language: "text",
          code: '✓ Published "My Publication Title"\n\n  View      https://app.agent-paste.sh/v/art_01H...\n  Expires   2026-06-20\n  Upload    3/3 uploaded, 0 reused · 42 KB sent, 0 B cached\n\n  Update    npx @zaks-io/agent-paste publish ./report --artifact-id art_01H...\n            (revises this Artifact; same link live-updates the open page)\n\n  → open https://app.agent-paste.sh/v/art_01H...',
        },
        {
          kind: "note",
          title: "Do not verify Private Links with status code alone",
          body: [
            "A `private_url` opens the app viewer for a signed-in Workspace Member. Plain HTTP clients can receive the app shell or sign-in redirect state with a 200 response; that does not make the Artifact reachable without login. Use `set-visibility <artifact-id> unlisted` for a no-login browser link, and use `agent_view_url` plus Agent View `files[].url` entries for machine verification.",
          ],
        },
        {
          kind: "note",
          title: "Authenticated unlisted sharing is a separate step",
          body: [
            "Authenticated publish is content-only and private; `private_url` is the login-walled `/v/<artifactId>` clean viewer. When a human needs a no-login URL that follows later publishes, run `agent-paste set-visibility <artifact-id> unlisted`; it mints or reuses the one unlisted Share Link and returns `unlisted_url`. Accountless `--ephemeral` publish is the exception: it auto-creates that unlisted Share Link and returns `unlisted_url` immediately. `set-visibility <artifact-id> private` revokes active Access Links. `revision_content_url` is raw signed byte delivery for one Revision.",
          ],
        },
        {
          kind: "note",
          title: "Ephemeral output leads with the no-login link",
          body: [
            "With `--ephemeral`, human-readable output leads with `unlisted_url`, the no-login script-disabled Share Link that works immediately. The `claim_url` is the keep/upgrade path for owning the Artifact and unlocking interactivity. If the publish command includes `--claim-code <clm_...>`, the CLI carries it into both links as the public `claim_code` query parameter. Agents should relay `unlisted_url` for viewing and never relay `private_url` from an unclaimed ephemeral publish.",
          ],
        },
        {
          kind: "note",
          title: "Check auth before ephemeral",
          body: [
            "Agents should run `agent-paste whoami --json` before using `--ephemeral`; it exits `0` either way, so check the JSON, not the exit code. If it reports you are signed in, publish normally. Ephemeral is fine for non-interactive text, markdown, images, and static HTML/CSS. It is wrong for interactive HTML/JS because scripts stay disabled while unclaimed; after claim, interactivity runs through the controlled Artifact Viewer.",
          ],
        },
      ],
    },
    {
      id: "pull-edit",
      title: "Pull and edit",
      blocks: [
        {
          kind: "paragraph",
          text: "`pull` reads one stored file back so an agent can inspect or edit against the current bytes. Plain `pull` writes the text body to stdout; `--json` adds metadata such as `sha256`, `size_bytes`, `is_binary`, and `body` when the file is UTF-8 text and within the inline size limit.",
        },
        {
          kind: "code",
          language: "sh",
          code: "agent-paste pull art_01H... index.html > current-index.html\nagent-paste pull art_01H... index.html --revision-id rev_01H... --json",
        },
        {
          kind: "paragraph",
          text: "`edit` applies the same literal find/replace shape as MCP `multi_edit`, then publishes a new Revision under the same stable Artifact link.",
        },
        {
          kind: "code",
          language: "sh",
          code: 'printf \'[{"old_string":"old","new_string":"new"}]\' |\n  agent-paste edit art_01H... index.html --json\n\nagent-paste edit art_01H... index.html --edits edits.json --json',
        },
        {
          kind: "paragraph",
          text: "Each `old_string` must match the current file exactly once unless `replace_all: true` is set. A non-matching or ambiguous edit fails loudly; pull the file first to get the exact base text.",
        },
      ],
    },
    {
      id: "retries",
      title: "Retries and local exclusions",
      blocks: [
        {
          kind: "paragraph",
          text: "The CLI generates one idempotency key per publish and reuses it across automatic retries, so transient failures do not create duplicate Artifacts or Revisions.",
        },
        {
          kind: "paragraph",
          text: "Folder uploads exclude `.git/`, `.DS_Store`, `node_modules/`, `.env`, and `.env.*`. The exclusion list is intentionally not configurable.",
        },
      ],
    },
  ],
};
