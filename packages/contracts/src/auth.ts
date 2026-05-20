import { z } from "zod";
import { ApiKeyBearer, ApiKeyId, IsoDateTime } from "./primitives.js";
import { WhoamiResponse } from "./workspace.js";

export const AuthWebCallbackRequest = z.object({
  id_token: z.string().min(1).max(20_000),
  nonce: z.string().min(16).max(500),
});
export type AuthWebCallbackRequest = z.infer<typeof AuthWebCallbackRequest>;

export const FirstRunApiKey = z.object({
  id: ApiKeyId,
  name: z.string().min(1).max(120),
  secret: ApiKeyBearer,
  created_at: IsoDateTime,
});
export type FirstRunApiKey = z.infer<typeof FirstRunApiKey>;

export const AuthWebCallbackResponse = z.object({
  whoami: WhoamiResponse,
  first_run_api_key: FirstRunApiKey.nullable(),
});
export type AuthWebCallbackResponse = z.infer<typeof AuthWebCallbackResponse>;
