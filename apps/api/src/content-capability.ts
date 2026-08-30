import { bytesFromReadableBody } from "@agent-paste/storage";
import { type ContentTokenPayload, mintContentToken } from "@agent-paste/tokens/content";
import {
  type ContentCapabilityManifest,
  contentCapabilityHostname,
  contentCapabilityObjectKey,
  parseContentCapabilityDomain,
  parseContentCapabilityManifest,
  serializeContentCapabilityManifest,
} from "@agent-paste/tokens/content-capability";
import type { Env } from "./env.js";

export async function storeContentCapability(input: {
  env: Env;
  payload: ContentTokenPayload;
  entrypoint: string;
  signingSecret: string;
  capabilityId: string;
  revisionNumber: number;
  artifactUpdatedAt: string;
}): Promise<string | undefined> {
  const configuredDomain = input.env.CONTENT_CAPABILITY_DOMAIN;
  if (!configuredDomain) {
    return undefined;
  }
  parseContentCapabilityDomain(configuredDomain);
  const bucket = input.env.ARTIFACTS;
  const put = bucket?.put;
  if (!put) {
    throw new Error("CONTENT_CAPABILITY_DOMAIN requires an ARTIFACTS R2 write binding.");
  }

  const manifest: ContentCapabilityManifest = {
    version: 1,
    signed_token: await mintContentToken(input.payload, input.signingSecret),
    entrypoint: input.entrypoint,
    revision_number: input.revisionNumber,
    artifact_updated_at: input.artifactUpdatedAt,
  };
  await writeLatestManifest(bucket, contentCapabilityObjectKey(input.capabilityId), manifest);
  return contentCapabilityOrigin(input.env, input.capabilityId);
}

export function contentCapabilityOrigin(env: Env, capabilityId: string): string | undefined {
  if (!env.CONTENT_CAPABILITY_DOMAIN) {
    return undefined;
  }
  return `https://${contentCapabilityHostname(
    capabilityId,
    parseContentCapabilityDomain(env.CONTENT_CAPABILITY_DOMAIN),
    env.CONTENT_CAPABILITY_HOST_SUFFIX,
  )}`;
}

async function writeLatestManifest(
  bucket: NonNullable<Env["ARTIFACTS"]>,
  key: string,
  manifest: ContentCapabilityManifest,
): Promise<void> {
  const put = bucket.put;
  if (!put) throw new Error("CONTENT_CAPABILITY_DOMAIN requires an ARTIFACTS R2 write binding.");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const currentObject = await bucket.get(key);
    const current = currentObject?.body
      ? parseContentCapabilityManifest(new TextDecoder().decode(await bytesFromReadableBody(currentObject.body)))
      : null;
    if (current && compareManifestState(current, manifest) >= 0) return;
    const written = await put.call(bucket, key, serializeContentCapabilityManifest(manifest), {
      httpMetadata: { contentType: "application/json" },
      onlyIf: currentObject?.etag ? { etagMatches: currentObject.etag } : { etagDoesNotMatch: "*" },
    });
    if (written !== null) return;
  }
  throw new Error("Content capability manifest update lost repeated conditional write races.");
}

function compareManifestState(left: ContentCapabilityManifest, right: ContentCapabilityManifest): number {
  if (left.revision_number !== right.revision_number) return left.revision_number - right.revision_number;
  return Date.parse(left.artifact_updated_at) - Date.parse(right.artifact_updated_at);
}

export function contentCapabilityUrl(origin: string, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${origin}/${encodedPath}`;
}
