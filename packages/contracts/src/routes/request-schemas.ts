import { AccessLinkResolveRequest, CreateAccessLinkRequest, UpdateDisplayMetadataRequest } from "../accessLinks.js";
import { CreateApiKeyRequest } from "../apiKeys.js";
import { CreateCheckoutSessionRequest, SetWorkspacePlanRequest } from "../billing.js";
import { EphemeralClaimRequest, EphemeralProvisionRequest } from "../ephemeral.js";
import { SetLockdownRequest } from "../lockdown.js";
import { PublishRevisionRequest } from "../revisions.js";
import { CreateUploadSessionRequest } from "../uploadSessions.js";
import { UpdateWebSettingsRequest } from "../web.js";
import type { RouteContract } from "./types.js";

export const requestSchemas = {
  AccessLinkResolveRequest,
  CreateAccessLinkRequest,
  CreateApiKeyRequest,
  CreateCheckoutSessionRequest,
  CreateUploadSessionRequest,
  EphemeralProvisionRequest,
  EphemeralClaimRequest,
  PublishRevisionRequest,
  SetLockdownRequest,
  SetWorkspacePlanRequest,
  UpdateDisplayMetadataRequest,
  UpdateWebSettingsRequest,
} as const;
export type RequestSchemaName = keyof typeof requestSchemas;

export function requestSchemaFor(contract: Pick<RouteContract, "requestSchema">) {
  return contract.requestSchema ? requestSchemas[contract.requestSchema] : undefined;
}
