import { queryOptions } from "@tanstack/react-query";
import {
  getArtifactFn,
  listAccessLinksFn,
  listArtifactAccessLinksFn,
  listArtifactRevisionsFn,
  listArtifactsFn,
  listAuditFn,
  listKeysFn,
  loadAdminFn,
  loadBillingFn,
  loadDashboardFn,
  loadSettingsFn,
  provisionWebMemberSessionFn,
} from "../rpc/web-loaders";
import type { OperatorEventSearch } from "./operator-events";

// Repeat navigation should serve cache instead of blocking on a refetch. These
// windows are well under any human's perception of staleness for this data, and
// window-focus + explicit invalidation (mutations, SSE) still force fresh reads.
// See AP-256.
const MINUTE = 60_000;
const STALE = {
  list: 2 * MINUTE,
  stable: 5 * MINUTE,
} as const;

/**
 * Single source of truth for query cache keys. Loaders, SSE handlers, and
 * mutations all import these so invalidation stays in sync with no
 * stringly-typed drift.
 */
export const queryKeys = {
  dashboard: () => ["dashboard"] as const,
  artifacts: () => ["artifacts"] as const,
  artifact: (artifactId: string) => ["artifact", artifactId] as const,
  artifactAccessLinks: (artifactId: string) => ["artifact-access-links", artifactId] as const,
  artifactRevisions: (artifactId: string) => ["artifact-revisions", artifactId] as const,
  audit: () => ["audit"] as const,
  keys: () => ["keys"] as const,
  accessLinks: () => ["access-links"] as const,
  settings: () => ["settings"] as const,
  billing: () => ["billing"] as const,
  webSession: () => ["web-session"] as const,
  admin: (search: OperatorEventSearch) => ["admin", search] as const,
};

/**
 * Workspace provisioning (the `/v1/auth/web/callback` DB write) fired off the
 * navigation critical path by the authed layout. Cached so it runs at most once
 * per stale window instead of on every page transition. See AP-256.
 */
export const webSessionQuery = () =>
  queryOptions({
    queryKey: queryKeys.webSession(),
    queryFn: () => provisionWebMemberSessionFn(),
    staleTime: STALE.stable,
  });

export const dashboardQuery = () =>
  queryOptions({
    queryKey: queryKeys.dashboard(),
    queryFn: () => loadDashboardFn(),
    staleTime: STALE.list,
  });

export const artifactsQuery = () =>
  queryOptions({
    queryKey: queryKeys.artifacts(),
    queryFn: () => listArtifactsFn(),
    staleTime: STALE.list,
  });

export const artifactQuery = (artifactId: string) =>
  queryOptions({
    queryKey: queryKeys.artifact(artifactId),
    queryFn: () => getArtifactFn({ data: { artifactId } }),
  });

export const artifactAccessLinksQuery = (artifactId: string) =>
  queryOptions({
    queryKey: queryKeys.artifactAccessLinks(artifactId),
    queryFn: () => listArtifactAccessLinksFn({ data: { artifactId } }),
  });

export const artifactRevisionsQuery = (artifactId: string) =>
  queryOptions({
    queryKey: queryKeys.artifactRevisions(artifactId),
    queryFn: () => listArtifactRevisionsFn({ data: { artifactId } }),
  });

export const auditQuery = () =>
  queryOptions({
    queryKey: queryKeys.audit(),
    queryFn: () => listAuditFn(),
    staleTime: STALE.list,
  });

export const keysQuery = () =>
  queryOptions({
    queryKey: queryKeys.keys(),
    queryFn: () => listKeysFn(),
    staleTime: STALE.stable,
  });

export const accessLinksQuery = () =>
  queryOptions({
    queryKey: queryKeys.accessLinks(),
    queryFn: () => listAccessLinksFn(),
    staleTime: STALE.list,
  });

export const settingsQuery = () =>
  queryOptions({
    queryKey: queryKeys.settings(),
    queryFn: () => loadSettingsFn(),
    staleTime: STALE.stable,
  });

export const billingQuery = () =>
  queryOptions({
    queryKey: queryKeys.billing(),
    queryFn: () => loadBillingFn(),
    staleTime: STALE.stable,
  });

export const adminQuery = (search: OperatorEventSearch) =>
  queryOptions({
    queryKey: queryKeys.admin(search),
    queryFn: () => loadAdminFn({ data: search }),
  });
