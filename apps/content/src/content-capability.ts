import {
  contentCapabilityIdFromHostname,
  contentCapabilityObjectKey,
  parseContentCapabilityDomain,
  parseContentCapabilityManifest,
} from "@agent-paste/tokens/content-capability";
import type { Env } from "./env.js";

const MAX_CONTENT_CAPABILITY_MANIFEST_SIZE = 72 * 1024;
const capabilityRequests = new WeakSet<Request>();

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
  const hostSuffix = env.CONTENT_CAPABILITY_HOST_SUFFIX;
  if (isLegacyContentHostname(url.hostname, env.CONTENT_BASE_URL)) {
    return { kind: "pass" };
  }
  const capabilityId = contentCapabilityIdFromHostname(url.hostname, domain, hostSuffix);
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

function isLegacyContentHostname(hostname: string, contentBaseUrl: string | undefined): boolean {
  if (!contentBaseUrl) {
    return false;
  }
  try {
    return new URL(contentBaseUrl).hostname === hostname.toLowerCase();
  } catch {
    throw new Error("CONTENT_BASE_URL must be an absolute URL.");
  }
}

export function markContentCapabilityRequest(request: Request): Request {
  capabilityRequests.add(request);
  return request;
}

export function isContentCapabilityRequest(request: Request): boolean {
  return capabilityRequests.has(request);
}

export function isContentRouteOriginRequest(request: Request, env: Env): boolean {
  const configuredHosts = env.CONTENT_ROUTE_ORIGIN_HOSTS;
  if (!configuredHosts) {
    return false;
  }

  const requestHostname = new URL(request.url).hostname.toLowerCase();
  const originHosts = configuredHosts.split(",").map((configuredHost) => {
    const host = configuredHost.trim().toLowerCase();
    if (!host || new URL(`https://${host}/`).host !== host) {
      throw new Error("CONTENT_ROUTE_ORIGIN_HOSTS must contain comma-separated hostnames.");
    }
    return host;
  });
  return originHosts.includes(requestHostname);
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
