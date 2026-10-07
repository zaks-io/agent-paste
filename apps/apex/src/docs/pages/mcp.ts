import type { DocsPage } from "../types";

export const MCP_DOC: DocsPage = {
  slug: "mcp",
  title: "MCP Server",
  shortTitle: "MCP",
  summary: "Hosted agents can publish, inspect, and revise text Artifacts over OAuth-only MCP.",
  sections: [
    {
      id: "connect",
      title: "Connect",
      blocks: [
        {
          kind: "paragraph",
          text: "Add `https://mcp.agent-paste.sh` as a remote MCP server, complete OAuth, then call `whoami`. Use MCP only when the host cannot run the CLI.",
        },
      ],
    },
    {
      id: "tools",
      title: "Tools",
      blocks: [
        {
          kind: "table",
          columns: ["Tool", "Purpose"],
          rows: [
            ["`feedback`", "Report product friction and return feedback_id; any authenticated member."],
            ["`whoami`", "Return the member, Workspace, and scopes."],
            ["`publish_artifact`", "Publish a new text Artifact and return its `url`."],
            ["`add_revision`", "Publish a new body for an existing Artifact; same `url`."],
            ["`multi_edit`", "Literal find/replace in one stored file; same `url`."],
            ["`list_artifacts`", "List Workspace Artifacts (`data[].id`)."],
            ["`read_artifact`", "Read the latest Agent View with per-file URLs."],
            ["`read_file`", "Read one stored file's text and sha256."],
            ["`list_revisions`", "List Revisions (`items[].revision_id`)."],
            ["`delete_artifact`", "Delete an Artifact."],
            ["`update_display_metadata`", "Rename an Artifact."],
          ],
        },
      ],
    },
    {
      id: "feedback",
      title: "Feedback",
      blocks: [
        {
          kind: "paragraph",
          text: "Call feedback with a body of 1 to 10,000 characters. Read-only members can submit. The tool attaches the MCP version and tool name and returns feedback_id. The input accepts only body. Invalid input returns invalid_params with HTTP 400. Keep secrets out of reports.",
        },
      ],
    },
    {
      id: "limits",
      title: "Limits",
      blocks: [
        {
          kind: "paragraph",
          text: "`artifact_id` accepts the ID (`01234-56789-abcde-fghjd`) or the full URL. MCP publishes text only; folders, binary files, and ephemeral publishing need the CLI. Updates require Workspace access.",
        },
      ],
    },
  ],
};
