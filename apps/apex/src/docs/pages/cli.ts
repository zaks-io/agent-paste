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
            ["`agent-paste login`", "Sign in through browser OAuth and store a scoped local credential."],
            ["`agent-paste logout`", "Revoke the stored credential when possible, then remove it locally."],
            ["`agent-paste whoami`", "Show the resolved Workspace, actor, and granted scopes."],
            ["`agent-paste publish <path>`", "Upload files, publish a Revision, and print the result."],
            ["`agent-paste version`", "Print the CLI version baked into the package or binary."],
            ["`agent-paste upgrade [<tag>]`", "Self-update a standalone binary install."],
          ],
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
            ["`--title <text>`", "Set the display title. Defaults to the file or folder name."],
            ["`--entrypoint <path>`", "Choose the file opened first by viewers."],
            [
              "`--render-mode <mode>`",
              "Override inferred mode: `html`, `markdown`, `text`, `image`, `audio`, or `video`.",
            ],
            [
              "`--ephemeral`",
              "Restricted accountless fallback for non-interactive text/images/static output. Ignores stored login, disables scripts while unclaimed, and prints a one-time claim link.",
            ],
            ["`--json`", "Emit pure JSON on stdout. Errors still go to stderr."],
            ["`--quiet`", "Suppress human-readable stdout."],
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
          text: "A successful CLI publish leads with `View`, the authenticated Artifact URL for the Workspace app, then an `Update` line: the one command to revise this Artifact in place (`publish <path> --artifact-id art_...`). The `Update` line is the explicit revise handle on the human surface — Revision IDs, `revision_content_url`, and `agent_view_url` stay in the JSON output. Revising keeps the same link and live-updates pages already open; publishing again without the id makes a new Artifact on a new link.",
        },
        {
          kind: "code",
          language: "text",
          code: '✓ Published "My Publication Title"\n\n  View      https://app.agent-paste.sh/artifacts/art_01H...\n  Expires   2026-06-20\n  Upload    3/3 uploaded, 0 reused · 42 KB sent, 0 B cached\n\n  Update    npx @zaks-io/agent-paste publish ./report --artifact-id art_01H...\n            (revises this Artifact; same link live-updates the open page)\n\n  → open https://app.agent-paste.sh/artifacts/art_01H...',
        },
        {
          kind: "note",
          title: "Public links are explicit",
          body: [
            "When a human needs a public/shareable URL that follows later publishes, publish with `--share` or explicitly create a Share Link and return `access_link_url`. `artifact_url` is the authenticated Workspace app view, and `revision_content_url` is raw signed byte delivery for one Revision.",
          ],
        },
        {
          kind: "note",
          title: "Ephemeral output leads with the claim link",
          body: [
            "With `--ephemeral`, human-readable output leads with `claim_url` — the link to open, keep, and unlock the Artifact. The authenticated Artifact URL appears as `View (works after claiming)`. Agents should relay the claim link to the user, not `artifact_url`.",
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
