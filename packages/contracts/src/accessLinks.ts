import { AgentView } from "./agentView.js";
import { AccessLinkId, ArtifactId, IsoDateTime, PlainTextTitle, RevisionId, UrlString } from "./primitives.js";
import { RenderMode } from "./revisions.js";
import { z } from "./zod.js";

export const AccessLinkPublicId = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{16}$/)
  .brand<"AccessLinkPublicId">();
export type AccessLinkPublicId = z.infer<typeof AccessLinkPublicId>;

export { AccessLinkId };

export const AccessLinkType = z.enum(["share", "revision"]);
export type AccessLinkType = z.infer<typeof AccessLinkType>;

export const AccessLinkScopesBitmask = z.number().int().min(0).max(65535);

export const AccessLinkRecord = z.object({
  id: AccessLinkId,
  workspace_id: z.string().uuid(),
  artifact_id: ArtifactId,
  revision_id: RevisionId.nullable(),
  public_id: AccessLinkPublicId,
  type: AccessLinkType,
  scopes_bitmask: AccessLinkScopesBitmask,
  expires_at: IsoDateTime.nullable(),
  created_by_type: z.enum(["api_key", "member"]),
  created_by_id: z.string().min(1),
  created_at: IsoDateTime,
  revoked_at: IsoDateTime.nullable(),
});
export type AccessLinkRecord = z.infer<typeof AccessLinkRecord>;

export const AccessLinkSignedUrl = z.object({
  url: UrlString,
});
export type AccessLinkSignedUrl = z.infer<typeof AccessLinkSignedUrl>;

export const AccessLinkResolveRequest = z.object({
  public_id: AccessLinkPublicId,
  blob: z.string().min(1),
});
export type AccessLinkResolveRequest = z.infer<typeof AccessLinkResolveRequest>;

export const AccessLinkResolveResponse = z.object({
  agent_view: AgentView,
  render_mode: RenderMode,
  iframe_src: UrlString,
  title: PlainTextTitle,
});
export type AccessLinkResolveResponse = z.infer<typeof AccessLinkResolveResponse>;
