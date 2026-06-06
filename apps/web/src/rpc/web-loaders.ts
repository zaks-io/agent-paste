import { createServerFn } from "@tanstack/react-start";
import type { OperatorEventSearch } from "../lib/operator-events";

export type RootLoaderData = {
  webBaseUrl: string;
  sentry: { dsn: string | undefined; environment: string };
  analyticsToken: string | undefined;
};

export const loadRootEnvFn = createServerFn({ method: "GET" }).handler(async () => {
  const { loadRootEnv } = await import("../server/web-loaders");
  return loadRootEnv();
});

export const loadRootAuthFn = createServerFn({ method: "GET" }).handler(async () => {
  const { loadRootAuth } = await import("../server/web-loaders");
  return loadRootAuth();
});

export const loadAuthedSessionFn = createServerFn({ method: "GET" })
  .inputValidator((input: { allowGuest?: boolean; returnPathname?: string }) => input)
  .handler(async ({ data }) => {
    const { loadAuthedSession } = await import("../server/web-loaders");
    return loadAuthedSession(data);
  });

export const provisionWebMemberSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const { provisionWebMemberSession } = await import("../server/web-loaders");
  return provisionWebMemberSession();
});

export const loadDashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  const { loadDashboard } = await import("../server/web-loaders");
  return loadDashboard();
});

export const listArtifactsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listArtifacts } = await import("../server/web-loaders");
  return listArtifacts();
});

export const getArtifactFn = createServerFn({ method: "GET" })
  .inputValidator((input: { artifactId: string }) => input)
  .handler(async ({ data }) => {
    const { getArtifact } = await import("../server/web-loaders");
    return getArtifact(data);
  });

export const listAuditFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listAudit } = await import("../server/web-loaders");
  return listAudit();
});

export const listKeysFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listKeys } = await import("../server/web-loaders");
  return listKeys();
});

export const listAccessLinksFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listAccessLinks } = await import("../server/web-loaders");
  return listAccessLinks();
});

export const listArtifactAccessLinksFn = createServerFn({ method: "GET" })
  .inputValidator((input: { artifactId: string }) => input)
  .handler(async ({ data }) => {
    const { listArtifactAccessLinks } = await import("../server/web-loaders");
    return listArtifactAccessLinks(data);
  });

export const listArtifactRevisionsFn = createServerFn({ method: "GET" })
  .inputValidator((input: { artifactId: string }) => input)
  .handler(async ({ data }) => {
    const { listArtifactRevisions } = await import("../server/web-loaders");
    return listArtifactRevisions(data);
  });

export const loadSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { loadSettings } = await import("../server/web-loaders");
  return loadSettings();
});

export const loadBillingFn = createServerFn({ method: "GET" }).handler(async () => {
  const { loadBilling } = await import("../server/web-loaders");
  return loadBilling();
});

export const activateBillingReturnFn = createServerFn({ method: "GET" })
  .inputValidator((input: { sessionId: string }) => input)
  .handler(async ({ data }) => {
    const { activateBillingReturn } = await import("../server/web-loaders");
    return activateBillingReturn(data);
  });

export const loadAdminFn = createServerFn({ method: "GET" })
  .inputValidator((search: OperatorEventSearch) => search)
  .handler(async ({ data }) => {
    const { loadAdmin } = await import("../server/web-loaders");
    return loadAdmin(data);
  });

export const loadClaimPageFn = createServerFn({ method: "GET" }).handler(async () => {
  const { loadClaimPage } = await import("../server/web-loaders");
  return loadClaimPage();
});

export const healthFn = createServerFn({ method: "GET" }).handler(async () => {
  return { ok: true, app: "web" };
});
