import { z } from "zod";
import { AgentView } from "./agentView.js";
import { CreateRevisionLinkRequest, CreateShareLinkRequest } from "./artifacts.js";
import { PageInfo } from "./common.js";
import { AccessLinkType } from "./enums.js";
import { AccessLinkId, AccessLinkPublicId, ArtifactId, IsoDateTime, RevisionId, UrlString } from "./primitives.js";

export const CreateAccessLinkRequest = z.discriminatedUnion("type", [
  CreateShareLinkRequest,
  CreateRevisionLinkRequest,
]);
export type CreateAccessLinkRequest = z.infer<typeof CreateAccessLinkRequest>;

export const AccessLinkDetail = z.object({
  id: AccessLinkId,
  public_id: AccessLinkPublicId,
  artifact_id: ArtifactId,
  revision_id: RevisionId.nullable(),
  type: AccessLinkType,
  expires_at: IsoDateTime.nullable(),
  revoked_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
});
export type AccessLinkDetail = z.infer<typeof AccessLinkDetail>;

export const AccessLinkListResponse = z.object({
  data: z.array(AccessLinkDetail),
  page_info: PageInfo,
});
export type AccessLinkListResponse = z.infer<typeof AccessLinkListResponse>;

export const CreateAccessLinkResponse = z.object({
  access_link: AccessLinkDetail,
  url: UrlString,
});
export type CreateAccessLinkResponse = z.infer<typeof CreateAccessLinkResponse>;

export const MintAccessLinkResponse = z.object({
  access_link_id: AccessLinkId,
  url: UrlString,
  url_expires_at: IsoDateTime,
});
export type MintAccessLinkResponse = z.infer<typeof MintAccessLinkResponse>;

export const RevokeAccessLinkResponse = z.object({
  access_link_id: AccessLinkId,
  revoked_at: IsoDateTime,
});
export type RevokeAccessLinkResponse = z.infer<typeof RevokeAccessLinkResponse>;

export const ResolveAccessLinkRequest = z.object({
  public_id: AccessLinkPublicId,
  blob: z.string().min(1).max(256),
});
export type ResolveAccessLinkRequest = z.infer<typeof ResolveAccessLinkRequest>;

export const ResolveAccessLinkResponse = AgentView.extend({
  access_link: z.object({
    id: AccessLinkId,
    type: AccessLinkType,
    artifact_id: ArtifactId,
    revision_id: RevisionId,
  }),
});
export type ResolveAccessLinkResponse = z.infer<typeof ResolveAccessLinkResponse>;
