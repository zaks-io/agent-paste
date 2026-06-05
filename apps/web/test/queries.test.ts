import { beforeEach, describe, expect, it, vi } from "vitest";

const getArtifactFn = vi.fn();
const listArtifactsFn = vi.fn();
const listAuditFn = vi.fn();
const listKeysFn = vi.fn();
const loadAdminFn = vi.fn();
const loadBillingFn = vi.fn();
const loadDashboardFn = vi.fn();
const loadSettingsFn = vi.fn();

vi.mock("../src/rpc/web-loaders", () => ({
  getArtifactFn: (...args: unknown[]) => getArtifactFn(...args),
  listArtifactsFn: (...args: unknown[]) => listArtifactsFn(...args),
  listAuditFn: (...args: unknown[]) => listAuditFn(...args),
  listKeysFn: (...args: unknown[]) => listKeysFn(...args),
  loadAdminFn: (...args: unknown[]) => loadAdminFn(...args),
  loadBillingFn: (...args: unknown[]) => loadBillingFn(...args),
  loadDashboardFn: (...args: unknown[]) => loadDashboardFn(...args),
  loadSettingsFn: (...args: unknown[]) => loadSettingsFn(...args),
}));

import {
  adminQuery,
  artifactQuery,
  artifactsQuery,
  auditQuery,
  billingQuery,
  dashboardQuery,
  keysQuery,
  queryKeys,
  settingsQuery,
} from "../src/lib/queries";

beforeEach(() => {
  for (const fn of [
    getArtifactFn,
    listArtifactsFn,
    listAuditFn,
    listKeysFn,
    loadAdminFn,
    loadBillingFn,
    loadDashboardFn,
    loadSettingsFn,
  ]) {
    fn.mockReset();
    fn.mockResolvedValue({ data: null, error: null });
  }
});

describe("queryKeys", () => {
  it("produces stable, distinct keys per resource", () => {
    expect(queryKeys.dashboard()).toEqual(["dashboard"]);
    expect(queryKeys.artifacts()).toEqual(["artifacts"]);
    expect(queryKeys.artifact("art_1")).toEqual(["artifact", "art_1"]);
    expect(queryKeys.audit()).toEqual(["audit"]);
    expect(queryKeys.keys()).toEqual(["keys"]);
    expect(queryKeys.settings()).toEqual(["settings"]);
    expect(queryKeys.billing()).toEqual(["billing"]);
    expect(queryKeys.admin({ workspace_id: "ws_1" })).toEqual(["admin", { workspace_id: "ws_1" }]);
  });

  it("scopes the artifact key by id", () => {
    expect(queryKeys.artifact("a")).not.toEqual(queryKeys.artifact("b"));
  });
});

describe("query option builders", () => {
  it("dashboardQuery delegates to loadDashboardFn", async () => {
    const opts = dashboardQuery();
    expect(opts.queryKey).toEqual(queryKeys.dashboard());
    await opts.queryFn?.({} as never);
    expect(loadDashboardFn).toHaveBeenCalledOnce();
  });

  it("artifactsQuery delegates to listArtifactsFn", async () => {
    const opts = artifactsQuery();
    expect(opts.queryKey).toEqual(queryKeys.artifacts());
    await opts.queryFn?.({} as never);
    expect(listArtifactsFn).toHaveBeenCalledOnce();
  });

  it("artifactQuery passes the artifactId through to getArtifactFn", async () => {
    const opts = artifactQuery("art_42");
    expect(opts.queryKey).toEqual(queryKeys.artifact("art_42"));
    await opts.queryFn?.({} as never);
    expect(getArtifactFn).toHaveBeenCalledWith({ data: { artifactId: "art_42" } });
  });

  it("auditQuery delegates to listAuditFn", async () => {
    const opts = auditQuery();
    expect(opts.queryKey).toEqual(queryKeys.audit());
    await opts.queryFn?.({} as never);
    expect(listAuditFn).toHaveBeenCalledOnce();
  });

  it("keysQuery delegates to listKeysFn", async () => {
    const opts = keysQuery();
    expect(opts.queryKey).toEqual(queryKeys.keys());
    await opts.queryFn?.({} as never);
    expect(listKeysFn).toHaveBeenCalledOnce();
  });

  it("settingsQuery delegates to loadSettingsFn", async () => {
    const opts = settingsQuery();
    expect(opts.queryKey).toEqual(queryKeys.settings());
    await opts.queryFn?.({} as never);
    expect(loadSettingsFn).toHaveBeenCalledOnce();
  });

  it("billingQuery delegates to loadBillingFn", async () => {
    const opts = billingQuery();
    expect(opts.queryKey).toEqual(queryKeys.billing());
    await opts.queryFn?.({} as never);
    expect(loadBillingFn).toHaveBeenCalledOnce();
  });

  it("adminQuery passes the search through to loadAdminFn", async () => {
    const search = { focus: "security" } as const;
    const opts = adminQuery(search);
    expect(opts.queryKey).toEqual(queryKeys.admin(search));
    await opts.queryFn?.({} as never);
    expect(loadAdminFn).toHaveBeenCalledWith({ data: search });
  });
});
