import type { z } from "../zod.js";
import {
  McpAddRevisionInput,
  McpCreateRevisionLinkInput,
  McpCreateRevisionLinkOutput,
  McpDeleteArtifactInput,
  McpDeleteArtifactOutput,
  McpListAccessLinksInput,
  McpListAccessLinksOutput,
  McpListArtifactsInput,
  McpListArtifactsOutput,
  McpListRevisionsInput,
  McpListRevisionsOutput,
  McpMakePublicInput,
  McpMakePublicOutput,
  McpPublishArtifactInput,
  McpPublishArtifactOutput,
  McpReadArtifactInput,
  McpReadArtifactOutput,
  McpRevokeAccessLinkInput,
  McpRevokeAccessLinkOutput,
  type McpToolName,
  McpUpdateDisplayMetadataInput,
  McpUpdateDisplayMetadataOutput,
  McpWhoamiInput,
  McpWhoamiResponse,
} from "./schemas.js";

export const mcpToolInputSchemas = {
  publish_artifact: McpPublishArtifactInput,
  add_revision: McpAddRevisionInput,
  list_artifacts: McpListArtifactsInput,
  read_artifact: McpReadArtifactInput,
  list_revisions: McpListRevisionsInput,
  delete_artifact: McpDeleteArtifactInput,
  update_display_metadata: McpUpdateDisplayMetadataInput,
  make_public: McpMakePublicInput,
  create_revision_link: McpCreateRevisionLinkInput,
  list_access_links: McpListAccessLinksInput,
  revoke_access_link: McpRevokeAccessLinkInput,
  whoami: McpWhoamiInput,
} as const satisfies Record<McpToolName, z.ZodTypeAny>;

export const mcpToolOutputSchemas = {
  publish_artifact: McpPublishArtifactOutput,
  add_revision: McpPublishArtifactOutput,
  list_artifacts: McpListArtifactsOutput,
  read_artifact: McpReadArtifactOutput,
  list_revisions: McpListRevisionsOutput,
  delete_artifact: McpDeleteArtifactOutput,
  update_display_metadata: McpUpdateDisplayMetadataOutput,
  make_public: McpMakePublicOutput,
  create_revision_link: McpCreateRevisionLinkOutput,
  list_access_links: McpListAccessLinksOutput,
  revoke_access_link: McpRevokeAccessLinkOutput,
  whoami: McpWhoamiResponse,
} as const satisfies Record<McpToolName, z.ZodTypeAny>;

export type McpToolInputSchemaName = keyof typeof mcpToolInputSchemas;
export type McpToolOutputSchemaName = keyof typeof mcpToolOutputSchemas;
