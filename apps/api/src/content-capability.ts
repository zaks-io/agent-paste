import { type ContentTokenPayload, mintContentToken } from "@agent-paste/tokens/content";
import {
  contentCapabilityObjectKey,
  mintContentCapabilityId,
  parseContentCapabilityDomain,
  serializeContentCapabilityManifest,
} from "@agent-paste/tokens/content-capability";
import type { Env } from "./env.js";

export async function storeContentCapability(input: {
  env: Env;
  payload: ContentTokenPayload;
  entrypoint: string;
  signingSecret: string;
}): Promise<string | undefined> {
  const configuredDomain = input.env.CONTENT_CAPABILITY_DOMAIN;
  if (!configuredDomain) {
    return undefined;
  }
  const domain = parseContentCapabilityDomain(configuredDomain);
  const put = input.env.ARTIFACTS?.put;
  if (!put) {
    throw new Error("CONTENT_CAPABILITY_DOMAIN requires an ARTIFACTS R2 write binding.");
  }

  const capabilityId = mintContentCapabilityId();
  const signedToken = await mintContentToken(input.payload, input.signingSecret);
  await put.call(
    input.env.ARTIFACTS,
    contentCapabilityObjectKey(capabilityId),
    serializeContentCapabilityManifest({
      version: 1,
      signed_token: signedToken,
      entrypoint: input.entrypoint,
    }),
    { httpMetadata: { contentType: "application/json" } },
  );
  return `https://${capabilityId}.${domain}`;
}

export function contentCapabilityUrl(origin: string, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${origin}/${encodedPath}`;
}
