import type { Clock } from "./clock.js";
import { sign, verify } from "./codec.js";
import { encodePath } from "./url.js";

export type ContentTokenPayload = {
  workspace_id?: string;
  artifact_id: string;
  revision_id: string;
  access_link_id?: string;
  key_prefix?: string;
  object_key?: string;
  object_keys?: Record<string, string>;
  paths?: string[];
  /** When true, content responses must not be indexed (ephemeral tier). */
  noindex?: boolean;
  /** When true, content responses use the script-disabled Execution Policy (ephemeral tier). */
  script_disabled?: boolean;
  exp: number;
};

export function isValidContentTokenPayload(value: unknown): value is ContentTokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const payload = value as Partial<ContentTokenPayload>;
  return (
    typeof payload.artifact_id === "string" &&
    payload.artifact_id.startsWith("art_") &&
    typeof payload.revision_id === "string" &&
    payload.revision_id.startsWith("rev_") &&
    (payload.workspace_id === undefined ||
      (typeof payload.workspace_id === "string" && payload.workspace_id.length > 0)) &&
    (payload.access_link_id === undefined ||
      (typeof payload.access_link_id === "string" && payload.access_link_id.startsWith("al_"))) &&
    (payload.key_prefix === undefined || (typeof payload.key_prefix === "string" && payload.key_prefix.length > 0)) &&
    (payload.object_key === undefined || (typeof payload.object_key === "string" && payload.object_key.length > 0)) &&
    (payload.object_keys === undefined ||
      (isStringRecord(payload.object_keys) &&
        Object.entries(payload.object_keys).every(([path, objectKey]) => path.length > 0 && objectKey.length > 0))) &&
    (payload.paths === undefined ||
      (Array.isArray(payload.paths) && payload.paths.every((path) => typeof path === "string"))) &&
    (payload.noindex === undefined || typeof payload.noindex === "boolean") &&
    (payload.script_disabled === undefined || typeof payload.script_disabled === "boolean") &&
    typeof payload.exp === "number" &&
    Number.isInteger(payload.exp)
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

export function mintContentToken(payload: ContentTokenPayload, secret: string): Promise<string> {
  return sign(payload, secret);
}

export function verifyContentToken(token: string, secret: string, clock?: Clock): Promise<ContentTokenPayload | null> {
  return verify(token, secret, { isValid: isValidContentTokenPayload, clock });
}

/** Signs a content token and builds the Content Origin URL `{baseUrl}/v/{token}/{path}`. */
export async function mintContentUrl(input: {
  baseUrl: string;
  secret: string;
  payload: ContentTokenPayload;
  path: string;
}): Promise<string> {
  const token = await mintContentToken(input.payload, input.secret);
  return `${input.baseUrl}/v/${encodeURIComponent(token)}/${encodePath(input.path)}`;
}

/** Signs a bundle token and builds the Content Origin URL `{baseUrl}/b/{token}`. */
export async function mintBundleUrl(input: {
  baseUrl: string;
  secret: string;
  payload: ContentTokenPayload;
}): Promise<string> {
  const token = await mintContentToken(input.payload, input.secret);
  return `${input.baseUrl}/b/${encodeURIComponent(token)}`;
}
