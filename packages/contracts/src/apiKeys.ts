import { z } from "zod";
import { PageInfo } from "./common.js";
import { AgentScope } from "./enums.js";
import { ApiKeyBearer, ApiKeyId, IsoDateTime } from "./primitives.js";

export const ApiKeySummary = z.object({
  id: ApiKeyId,
  name: z.string().min(1).max(120),
  public_id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{16}$/),
  scopes: z.array(AgentScope).min(1),
  expires_at: IsoDateTime.nullable(),
  revoked_at: IsoDateTime.nullable(),
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
  scopes: z.array(AgentScope).min(1),
  expires_at: IsoDateTime.nullable().optional(),
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequest>;

export const CreateApiKeyResponse = z.object({
  api_key: ApiKeySummary,
  secret: ApiKeyBearer,
});
export type CreateApiKeyResponse = z.infer<typeof CreateApiKeyResponse>;

export const RevokeApiKeyResponse = z.object({
  api_key_id: ApiKeyId,
  revoked_at: IsoDateTime,
});
export type RevokeApiKeyResponse = z.infer<typeof RevokeApiKeyResponse>;
