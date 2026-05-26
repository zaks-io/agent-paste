import { USAGE_POLICY } from "@agent-paste/config";
import { ActorType, Scope } from "./enums.js";
import { ApiKeyId, IsoDateTime, WorkspaceId } from "./primitives.js";
import { z } from "./zod.js";

export const UsagePolicy = z.object({
  file_size_cap_bytes: z.number().int().positive(),
  artifact_size_cap_bytes: z.number().int().positive(),
  file_count_cap: z.number().int().positive(),
  actor_rate_limit_per_minute: z.number().int().positive(),
  workspace_burst_cap_per_minute: z.number().int().positive(),
  upload_session_ttl_seconds: z.number().int().positive(),
  default_ttl_seconds: z.number().int().positive(),
  min_ttl_seconds: z.number().int().positive(),
  max_ttl_seconds: z.number().int().positive(),
});
export type UsagePolicy = z.infer<typeof UsagePolicy>;

export const mvpUsagePolicy = USAGE_POLICY satisfies UsagePolicy;

export const WorkspaceSummary = z.object({
  id: WorkspaceId,
  name: z.string().min(1).max(120),
  created_at: IsoDateTime,
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummary>;

export const WhoamiResponse = z.object({
  actor: z.object({
    type: z.literal(ActorType.enum.api_key),
    id: ApiKeyId,
    name: z.string().min(1).max(120),
  }),
  workspace: WorkspaceSummary,
  scopes: z.array(Scope),
  usage_policy: UsagePolicy,
});
export type WhoamiResponse = z.infer<typeof WhoamiResponse>;
