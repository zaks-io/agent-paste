import { PageInfo } from "./common.js";
import { Scope } from "./enums.js";
import { ApiKeyBearer, ApiKeyId, IsoDateTime, WorkspaceId } from "./primitives.js";
import { z } from "./zod.js";

export const ApiKeySummary = z.object({
  id: ApiKeyId,
  workspace_id: WorkspaceId,
  name: z.string().min(1).max(120),
  public_id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{16}$/),
  scopes: z.array(Scope).min(1),
  revoked_at: IsoDateTime.nullable(),
  expires_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  last_used_at: IsoDateTime.nullable(),
});
export type ApiKeySummary = z.infer<typeof ApiKeySummary>;

export const ApiKeyListResponse = z.object({
  data: z.array(ApiKeySummary),
  page_info: PageInfo,
});
export type ApiKeyListResponse = z.infer<typeof ApiKeyListResponse>;

export const CreateApiKeyRequest = z.object({
  name: z.string().trim().min(1).max(120),
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequest>;

export const CreateApiKeyResponse = z.object({
  api_key: ApiKeySummary,
  secret: ApiKeyBearer,
});
export type CreateApiKeyResponse = z.infer<typeof CreateApiKeyResponse>;
