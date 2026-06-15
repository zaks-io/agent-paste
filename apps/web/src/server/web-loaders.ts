import "@tanstack/react-start/server-only";

import { shouldDisableOptionalAnalytics } from "@agent-paste/brand";
import type {
  BillingInvoiceListResponse,
  BillingStatusResponse,
  LockdownListResponse,
  RevisionListResponse,
  UsagePolicy,
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
import { getRequestHeaderValue, getWebEnv } from "./runtime";
import { turnstileSiteKey } from "./turnstile";

const RECENT_LIMIT = 6;
const COUNT_LIMIT = 100;

function emptyFallback<T>(): LoaderFallback<T> {
  return { data: null, empty: true, error: null };
}

export function loadRootEnv() {
  const env = getWebEnv();
  const optionalAnalyticsDisabled = shouldDisableOptionalAnalytics({ getHeader: getRequestHeaderValue });
  return {
    webBaseUrl: env.WEB_BASE_URL,
    sentry: { dsn: env.SENTRY_DSN, environment: env.AGENT_PASTE_ENV },
    analyticsToken: optionalAnalyticsDisabled ? undefined : env.CF_WEB_ANALYTICS_TOKEN,
    optionalAnalyticsDisabled,
  };
}

export async function loadRootAuth() {
  const { user } = getServerAuth();
  return {
    signedIn: Boolean(user),
    signInHref: new URL("/api/auth/sign-in", getWebEnv().WEB_BASE_URL).toString(),
  };
}

/**
 * Resolves the authed-layout identity from the validated WorkOS token alone —
 * no API round-trip. Workspace provisioning (the `/v1/auth/web/callback` write)
 * is split into `provisionWebMemberSession` so navigation paints without
 * blocking on a DB write. See AP-256.
 */
export function loadAuthedSession(input: { allowGuest?: boolean; returnPathname?: string }) {
  const auth = getServerAuth();
  if (!auth.user) {
    if (input.allowGuest) return { guest: true as const };
    const signInUrl = new URL("/api/auth/sign-in", getWebEnv().WEB_BASE_URL);
    if (input.returnPathname) signInUrl.searchParams.set("returnPathname", input.returnPathname);
    return { redirectTo: signInUrl.toString() };
  }
  return { user: auth.user, isOperator: hasOperatorRole(auth) };
}

/**
 * Provisions/touches the web member (upserts on first login, bumps last_seen_at,
 * heals claimed_at) and returns the resulting workspace + default key. This is a
 * DB write, kept intact — it is just no longer awaited on the navigation critical
 * path; the layout fires it after first paint.
 */
export async function provisionWebMemberSession() {
  const auth = getServerAuth();
  if (!auth.user) return emptyFallback<WebAuthCallbackResponse>();
  return apiFetchOrEmpty<WebAuthCallbackResponse>("/v1/auth/web/callback", {
    method: "POST",
    accessToken: auth.accessToken,
  });
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

export type BillingPageData = {
  status: LoaderFallback<BillingStatusResponse>;
  invoices: LoaderFallback<BillingInvoiceListResponse>;
};

export async function loadBilling(): Promise<BillingPageData> {
  const auth = getServerAuth();
  if (!auth.user) {
    return { status: emptyFallback<BillingStatusResponse>(), invoices: emptyFallback<BillingInvoiceListResponse>() };
  }
  const token = { accessToken: auth.accessToken };
  const [status, invoices] = await Promise.all([
    apiFetchOrEmpty<BillingStatusResponse>("/v1/web/billing", token),
    apiFetchOrEmpty<BillingInvoiceListResponse>("/v1/web/billing/invoices", token),
  ]);
  return { status, invoices };
}

/** Synchronously activates Pro on return from Stripe Checkout, then returns fresh status. */
export async function activateBillingReturn(input: { sessionId: string }): Promise<BillingPageData> {
  const auth = getServerAuth();
  if (!auth.user) {
    return { status: emptyFallback<BillingStatusResponse>(), invoices: emptyFallback<BillingInvoiceListResponse>() };
  }
  const token = { accessToken: auth.accessToken };
  const [status, invoices] = await Promise.all([
    apiFetchOrEmpty<BillingStatusResponse>(
      `/v1/web/billing/return?session_id=${encodeURIComponent(input.sessionId)}`,
      token,
    ),
    apiFetchOrEmpty<BillingInvoiceListResponse>("/v1/web/billing/invoices", token),
  ]);
  return { status, invoices };
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

export type ClaimPageData = {
  turnstileSiteKey: string | null;
  billing: LoaderFallback<BillingStatusResponse>;
  usagePolicy: LoaderFallback<UsagePolicy>;
};

export async function loadClaimPage(): Promise<ClaimPageData> {
  const auth = getServerAuth();
  if (!auth.user) {
    return {
      turnstileSiteKey: turnstileSiteKey(),
      billing: emptyFallback<BillingStatusResponse>(),
      usagePolicy: emptyFallback<UsagePolicy>(),
    };
  }
  const token = { accessToken: auth.accessToken };
  const [billing, workspace] = await Promise.all([
    apiFetchOrEmpty<BillingStatusResponse>("/v1/web/billing", token),
    apiFetchOrEmpty<WebWorkspaceResponse>("/v1/web/workspace", token),
  ]);
  return {
    turnstileSiteKey: turnstileSiteKey(),
    billing,
    usagePolicy: workspace.data
      ? { data: workspace.data.usage_policy, empty: false, error: null }
      : emptyFallback<UsagePolicy>(),
  };
}
