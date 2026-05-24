import { generateApiKey } from "../api-keys.js";
import { createId } from "../id.js";
import { type toApiKeySummary, toWorkspaceSummary } from "../transforms.js";
import type { ApiKey, RepositoryOptions, Workspace, WorkspaceMember } from "../types.js";

export const DEFAULT_MEMBER_SCOPES = ["publish", "read", "admin"] as const;

export function toWorkspaceMemberSummary(member: WorkspaceMember) {
  return {
    id: member.id,
    workspace_id: member.workspace_id,
    email: member.email,
    scopes: member.scopes,
    created_at: member.created_at,
    last_seen_at: member.last_seen_at,
  };
}

export function webAuthResponse(
  workspace: Workspace,
  member: WorkspaceMember,
  defaultApiKey: { api_key: ReturnType<typeof toApiKeySummary>; secret: string } | null,
) {
  return {
    workspace: toWorkspaceSummary(workspace),
    workspace_member: toWorkspaceMemberSummary(member),
    scopes: member.scopes,
    default_api_key: defaultApiKey,
  };
}

export async function buildApiKey(
  options: RepositoryOptions,
  input: { id?: string; workspaceId: string; name: string; now: string },
): Promise<{ apiKey: ApiKey; secret: string }> {
  const generated = await generateApiKey(options.apiKeyEnv ?? "preview", options.apiKeyPepper);
  const apiKey: ApiKey = {
    id: input.id ?? createId("key"),
    workspace_id: input.workspaceId,
    public_id: generated.publicId,
    name: input.name,
    secret_hmac: generated.secretHmac,
    pepper_kid: 1,
    scopes: ["publish", "read"],
    revoked_at: null,
    last_used_at: null,
    created_at: input.now,
  };
  return { apiKey, secret: generated.secret };
}
