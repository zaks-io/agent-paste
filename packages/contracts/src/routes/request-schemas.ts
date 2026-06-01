import { AccessLinkResolveRequest, CreateAccessLinkRequest, UpdateDisplayMetadataRequest } from "../accessLinks.js";
import { CreateApiKeyRequest } from "../apiKeys.js";
import { SetLockdownRequest } from "../lockdown.js";
import { CreateUploadSessionRequest } from "../uploadSessions.js";
import { UpdateWebSettingsRequest } from "../web.js";
import type { RouteContract } from "./types.js";

export const requestSchemas = {
  AccessLinkResolveRequest,
  CreateAccessLinkRequest,
  CreateApiKeyRequest,
  CreateUploadSessionRequest,
  SetLockdownRequest,
  UpdateDisplayMetadataRequest,
  UpdateWebSettingsRequest,
} as const;
export type RequestSchemaName = keyof typeof requestSchemas;

export function requestSchemaFor(contract: Pick<RouteContract, "requestSchema">) {
  return contract.requestSchema ? requestSchemas[contract.requestSchema] : undefined;
}
