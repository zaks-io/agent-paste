import { z } from "zod";
import { PlatformLockdownScope } from "./enums.js";
import { ArtifactId, IsoDateTime, WorkspaceId } from "./primitives.js";

export const PlatformLockdownRequest = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal(PlatformLockdownScope.enum.workspace),
    workspace_id: WorkspaceId,
    reason_code: z.string().regex(/^[a-z0-9_]+$/),
  }),
  z.object({
    scope: z.literal(PlatformLockdownScope.enum.artifact),
    artifact_id: ArtifactId,
    reason_code: z.string().regex(/^[a-z0-9_]+$/),
  }),
]);
export type PlatformLockdownRequest = z.infer<typeof PlatformLockdownRequest>;

export const PlatformLockdownResponse = z.object({
  scope: PlatformLockdownScope,
  target_id: z.string().min(1),
  active: z.boolean(),
  changed_at: IsoDateTime,
});
export type PlatformLockdownResponse = z.infer<typeof PlatformLockdownResponse>;
