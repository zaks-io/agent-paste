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
          text: "Connect `https://mcp.agent-paste.sh`, complete OAuth, then call `whoami`. Use MCP when the host cannot run the CLI.",
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
            ["`whoami`", "Return the member, Workspace, and derived scopes."],
            ["`publish_artifact`", "Publish a new text-only Artifact and return its top-level `url`."],
            ["`add_revision`", "Publish a Revision of an existing Artifact at the same `url`."],
            ["`multi_edit`", "Edit one stored file and publish a Revision."],
            ["`list_artifacts`", "List Workspace Artifacts."],
            ["`read_artifact`", "Read the latest Agent View."],
            ["`read_file`", "Read one stored file or its metadata."],
            ["`list_revisions`", "List Artifact Revisions."],
            ["`delete_artifact`", "Delete an Artifact."],
            ["`update_display_metadata`", "Update the Artifact title."],
          ],
        },
      ],
    },
    {
      id: "limits",
      title: "Limits",
      blocks: [
        {
          kind: "paragraph",
          text: "MCP publishing is text-only. Use the CLI for folders and binary files. All MCP publish paths return the same `url` contract as the CLI and accept no visibility mode.",
        },
      ],
    },
  ],
};
