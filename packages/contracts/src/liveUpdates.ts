import { AccessLinkPublicId } from "./accessLinks.js";
import { ArtifactId, PlainTextTitle, RevisionId, UrlString } from "./primitives.js";
import { RenderMode } from "./revisions.js";
import { z } from "./zod.js";

/** Per-artifact concurrent Live Update viewer cap (ADR 0069). */
export const LIVE_UPDATE_VIEWER_CAP = 10;

export const LiveUpdateAudience = z.enum(["share", "dashboard"]);
export type LiveUpdateAudience = z.infer<typeof LiveUpdateAudience>;

export const LiveUpdatePointer = z.object({
  revision_id: RevisionId,
  iframe_src: UrlString,
  render_mode: RenderMode,
  title: PlainTextTitle,
});
export type LiveUpdatePointer = z.infer<typeof LiveUpdatePointer>;

export const LiveUpdatePublishedRevisionEvent = z.object({
  type: z.literal("published_revision"),
  artifact_id: ArtifactId,
  pointer: LiveUpdatePointer,
});
export type LiveUpdatePublishedRevisionEvent = z.infer<typeof LiveUpdatePublishedRevisionEvent>;

export const LiveUpdateRevokedEvent = z.object({
  type: z.literal("revoked"),
  reason: z.enum(["access_link_lockdown", "platform_lockdown", "deletion", "takedown"]),
});
export type LiveUpdateRevokedEvent = z.infer<typeof LiveUpdateRevokedEvent>;

export const LiveUpdateSseEvent = z.discriminatedUnion("type", [
  LiveUpdatePublishedRevisionEvent,
  LiveUpdateRevokedEvent,
]);
export type LiveUpdateSseEvent = z.infer<typeof LiveUpdateSseEvent>;

export const LiveUpdateAuthorizeAccessLinkRequest = z.object({
  kind: z.literal("access_link"),
  public_id: AccessLinkPublicId,
  blob: z.string().min(1),
});

export const LiveUpdateAuthorizeDashboardRequest = z.object({
  kind: z.literal("dashboard"),
  artifact_id: ArtifactId,
});

export const LiveUpdateAuthorizeRequest = z.discriminatedUnion("kind", [
  LiveUpdateAuthorizeAccessLinkRequest,
  LiveUpdateAuthorizeDashboardRequest,
]);
export type LiveUpdateAuthorizeRequest = z.infer<typeof LiveUpdateAuthorizeRequest>;

export const LiveUpdateAuthorizeResponse = z.object({
  artifact_id: ArtifactId,
  audience: LiveUpdateAudience,
  pointer: LiveUpdatePointer,
});
export type LiveUpdateAuthorizeResponse = z.infer<typeof LiveUpdateAuthorizeResponse>;

/** Published revision metadata for DO fan-out; content URLs are signed per viewer. */
export const LiveUpdateRevisionNotice = z.object({
  revision_id: RevisionId,
  entrypoint: z.string().min(1),
  render_mode: RenderMode,
  title: PlainTextTitle,
});
export type LiveUpdateRevisionNotice = z.infer<typeof LiveUpdateRevisionNotice>;

export const LiveUpdatePublishNotify = z.object({
  op: z.literal("publish"),
  artifact_id: ArtifactId,
  revision: LiveUpdateRevisionNotice,
});
export type LiveUpdatePublishNotify = z.infer<typeof LiveUpdatePublishNotify>;

export const LiveUpdateDisconnectNotify = z.object({
  op: z.literal("disconnect"),
  artifact_id: ArtifactId,
  audiences: z.array(LiveUpdateAudience).min(1).max(LiveUpdateAudience.options.length),
  reason: LiveUpdateRevokedEvent.shape.reason,
});
export type LiveUpdateDisconnectNotify = z.infer<typeof LiveUpdateDisconnectNotify>;

export const LiveUpdateNotifyMessage = z.discriminatedUnion("op", [
  LiveUpdatePublishNotify,
  LiveUpdateDisconnectNotify,
]);
export type LiveUpdateNotifyMessage = z.infer<typeof LiveUpdateNotifyMessage>;

export const LIVE_UPDATE_AT_CAP_CODE = "live_update_at_cap" as const;
