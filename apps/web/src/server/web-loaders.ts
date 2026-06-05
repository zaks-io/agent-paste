import "@tanstack/react-start/server-only";

import type {
  LockdownListResponse,
  RevisionListResponse,
  WebAccessLinkListResponse,
  WebApiKeyListResponse,
  WebArtifactDetailResponse,
  WebArtifactListResponse,
  WebAuditListResponse,
  WebAuthCallbackResponse,
  WebOperatorEventListResponse,
  WebSettingsResponse,
  WebWorkspaceResponse,
} from "@agent-paste/contracts";
import type { LoaderFallback } from "../lib/api-error";
import { type OperatorEventSearch, operatorEventsQueryString } from "../lib/operator-events";
import { apiFetchOrEmpty } from "./api-client";
import { getServerAuth } from "./authkit";
import { hasOperatorRole } from "./env";
import { getWebEnv } from "./runtime";
import { turnstileSiteKey } from "./turnstile";

const RECENT_LIMIT = 6;
const COUNT_LIMIT = 100;

function emptyFallback<T>(): LoaderFallback<T> {
  return { data: null, empty: true, error: null };
}

export function loadRootEnv() {
  const env = getWebEnv();
  return {
    webBaseUrl: env.WEB_BASE_URL,
    sentry: { dsn: env.SENTRY_DSN, environment: env.AGENT_PASTE_ENV },
    analyticsToken: env.CF_WEB_ANALYTICS_TOKEN,
  };
}

export async function loadRootAuth() {
  const { user } = getServerAuth();
  return {
    signedIn: Boolean(user),
    signInHref: new URL("/api/auth/sign-in", getWebEnv().WEB_BASE_URL).toString(),
  };
}

export async function loadAuthedSession(input: { allowGuest?: boolean; returnPathname?: string }) {
  const auth = getServerAuth();
  if (!auth.user) {
    if (input.allowGuest) return { guest: true as const };
    const signInUrl = new URL("/api/auth/sign-in", getWebEnv().WEB_BASE_URL);
    if (input.returnPathname) signInUrl.searchParams.set("returnPathname", input.returnPathname);
    return { redirectTo: signInUrl.toString() };
  }

  const apiSession = await apiFetchOrEmpty<WebAuthCallbackResponse>("/v1/auth/web/callback", {
    method: "POST",
    accessToken: auth.accessToken,
  });
  return { user: auth.user, isOperator: hasOperatorRole(auth), apiSession };
}

export async function loadDashboard() {
  const auth = getServerAuth();
  if (!auth.user) {
    return { workspace: null, artifacts: null, audit: null };
  }
  const token = { accessToken: auth.accessToken };
  const [workspace, artifacts, audit] = await Promise.all([
    apiFetchOrEmpty<WebWorkspaceResponse>("/v1/web/workspace", token),
    apiFetchOrEmpty<WebArtifactListResponse>(`/v1/web/artifacts?limit=${COUNT_LIMIT}`, token),
    apiFetchOrEmpty<WebAuditListResponse>(`/v1/web/audit?limit=${RECENT_LIMIT}`, token),
  ]);
  return { workspace, artifacts, audit };
}

export async function listArtifacts() {
  const auth = getServerAuth();
  if (!auth.user) return emptyFallback<WebArtifactListResponse>();
  return apiFetchOrEmpty<WebArtifactListResponse>("/v1/web/artifacts", {
    accessToken: auth.accessToken,
  });
}

export async function getArtifact(input: { artifactId: string }) {
  const auth = getServerAuth();
  if (!auth.user) return emptyFallback<WebArtifactDetailResponse>();
  return apiFetchOrEmpty<WebArtifactDetailResponse>(`/v1/web/artifacts/${encodeURIComponent(input.artifactId)}`, {
    accessToken: auth.accessToken,
  });
}

export async function listAudit() {
  const auth = getServerAuth();
  if (!auth.user) return emptyFallback<WebAuditListResponse>();
  return apiFetchOrEmpty<WebAuditListResponse>("/v1/web/audit", {
    accessToken: auth.accessToken,
  });
}

export async function listKeys() {
  const auth = getServerAuth();
  if (!auth.user) return emptyFallback<WebApiKeyListResponse>();
  return apiFetchOrEmpty<WebApiKeyListResponse>("/v1/web/keys", {
    accessToken: auth.accessToken,
  });
}

export async function listAccessLinks() {
  const auth = getServerAuth();
  if (!auth.user) return emptyFallback<WebAccessLinkListResponse>();
  return apiFetchOrEmpty<WebAccessLinkListResponse>("/v1/web/access-links", {
    accessToken: auth.accessToken,
  });
}

export async function listArtifactAccessLinks(input: { artifactId: string }) {
  const auth = getServerAuth();
  if (!auth.user) return emptyFallback<WebAccessLinkListResponse>();
  return apiFetchOrEmpty<WebAccessLinkListResponse>(
    `/v1/web/artifacts/${encodeURIComponent(input.artifactId)}/access-links`,
    { accessToken: auth.accessToken },
  );
}

export async function listArtifactRevisions(input: { artifactId: string }) {
  const auth = getServerAuth();
  if (!auth.user) return emptyFallback<RevisionListResponse>();
  return apiFetchOrEmpty<RevisionListResponse>(`/v1/web/artifacts/${encodeURIComponent(input.artifactId)}/revisions`, {
    accessToken: auth.accessToken,
  });
}

export async function loadSettings() {
  const auth = getServerAuth();
  if (!auth.user) return emptyFallback<WebSettingsResponse>();
  return apiFetchOrEmpty<WebSettingsResponse>("/v1/web/settings", {
    accessToken: auth.accessToken,
  });
}

export async function loadAdmin(search: OperatorEventSearch) {
  const auth = getServerAuth();
  if (!auth.user || !hasOperatorRole(auth)) {
    return { allowed: false as const };
  }
  if (!auth.accessToken) {
    return {
      allowed: true as const,
      lockdowns: emptyFallback<LockdownListResponse>(),
      events: emptyFallback<WebOperatorEventListResponse>(),
    };
  }
  const [lockdowns, events] = await Promise.all([
    apiFetchOrEmpty<LockdownListResponse>("/v1/web/admin/lockdowns", { accessToken: auth.accessToken }),
    apiFetchOrEmpty<WebOperatorEventListResponse>(`/v1/web/admin/events${operatorEventsQueryString(search)}`, {
      accessToken: auth.accessToken,
    }),
  ]);
  return { allowed: true as const, lockdowns, events };
}

export function loadClaimPage() {
  return { turnstileSiteKey: turnstileSiteKey() };
}
