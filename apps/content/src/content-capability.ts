import {
  contentCapabilityIdFromHostname,
  contentCapabilityObjectKey,
  isContentCapabilityHostname,
  parseContentCapabilityDomain,
  parseContentCapabilityManifest,
} from "@agent-paste/tokens/content-capability";
import type { Env } from "./env.js";

const MAX_CONTENT_CAPABILITY_MANIFEST_SIZE = 72 * 1024;

export type ContentCapabilityResolution =
  | { kind: "pass" }
  | { kind: "not_found" }
  | { kind: "request"; request: Request };

export async function resolveContentCapabilityRequest(
  request: Request,
  env: Env,
): Promise<ContentCapabilityResolution> {
  const configuredDomain = env.CONTENT_CAPABILITY_DOMAIN;
  if (!configuredDomain) {
    return { kind: "pass" };
  }
  const domain = parseContentCapabilityDomain(configuredDomain);
  const url = new URL(request.url);
  if (!isContentCapabilityHostname(url.hostname, domain)) {
    return { kind: "pass" };
  }
  const capabilityId = contentCapabilityIdFromHostname(url.hostname, domain);
  if (!capabilityId) {
    return { kind: "not_found" };
  }

  const stored = await env.ARTIFACTS.get(contentCapabilityObjectKey(capabilityId));
  if (!stored?.body || stored.size > MAX_CONTENT_CAPABILITY_MANIFEST_SIZE) {
    return { kind: "not_found" };
  }
  const manifest = parseContentCapabilityManifest(await new Response(stored.body).text());
  if (!manifest) {
    return { kind: "not_found" };
  }

  const encodedPath = url.pathname === "/" ? encodePath(manifest.entrypoint) : url.pathname.slice(1);
  url.pathname = `/v/${encodeURIComponent(manifest.signed_token)}/${encodedPath}`;
  return { kind: "request", request: new Request(url, request) };
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
