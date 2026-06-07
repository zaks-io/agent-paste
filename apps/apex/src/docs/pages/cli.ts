import type { DocsPage } from "../types.js";

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
            ["`agent-paste login`", "Mint a browser-OAuth API Key with `publish` and `read` scopes."],
            ["`agent-paste logout`", "Revoke the stored API Key when possible, then remove local credentials."],
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
            ["`--ephemeral`", "Publish with no login or key, then print a one-time claim link."],
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
          text: "A successful publish returns `artifact_id`, `revision_id`, `title`, `view_url`, `agent_view_url`, `expires_at`, and `bundle`. `view_url` opens the content origin. `agent_view_url` returns machine-readable Agent View JSON.",
        },
        {
          kind: "code",
          language: "json",
          code: '{\n  "artifact_id": "art_01H...",\n  "revision_id": "rev_01H...",\n  "title": "My Publication Title",\n  "view_url": "https://usercontent.agent-paste.sh/v/...",\n  "agent_view_url": "https://api.agent-paste.sh/v1/public/agent-view/...",\n  "expires_at": "2026-06-20T00:00:00.000Z",\n  "bundle": {\n    "status": "pending",\n    "retry_after_seconds": 5\n  }\n}',
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
