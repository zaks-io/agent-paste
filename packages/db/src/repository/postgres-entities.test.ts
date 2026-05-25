import { describe, expect, it, vi } from "vitest";

const calls: Array<{ name: string; args: unknown[] }> = [];

function queryObject(names: string[]) {
  return Object.fromEntries(
    names.map((name) => [
      name,
      vi.fn((...args: unknown[]) => {
        calls.push({ name, args });
        return Promise.resolve(`${name}:result`);
      }),
    ]),
  );
}

vi.mock("../queries/index.js", () => ({
  workspaceQueries: queryObject(["insert", "findById", "listAll", "update"]),
  apiKeyQueries: queryObject([
    "insert",
    "findById",
    "findByPublicId",
    "listForWorkspace",
    "updateLastUsedAt",
    "updateRevokedAt",
  ]),
  workspaceMemberQueries: queryObject(["insert", "findById", "findByWorkOsUserId", "updateSeen"]),
  artifactQueries: queryObject(["insert", "findById", "listFiltered", "listWebPage", "updateExpiry"]),
  artifactFileQueries: queryObject(["insert", "listForArtifact"]),
  uploadSessionQueries: queryObject(["insert", "findById", "markFinalized"]),
  uploadSessionFileQueries: queryObject(["insert", "listForSession", "recordUpload"]),
  platformLockdownQueries: queryObject(["findEffective", "listEffectivePage", "insert", "markLifted"]),
  operationEventQueries: queryObject(["insert", "listAll", "listForWorkspace", "listWebPage", "listIdsForTarget"]),
}));

describe("postgresEntities", () => {
  it("forwards typed entity operations to query objects and keeps raw cleanup SQL", async () => {
    const sqlCalls: Array<{ query: string; params: readonly unknown[] }> = [];
    const sql = {
      async query<Row = Record<string, unknown>>(query: string, params: readonly unknown[] = []) {
        sqlCalls.push({ query, params });
        return { rows: [{ id: "row_1" }] as Row[] };
      },
      async transaction<T>(run: (tx: typeof sql) => Promise<T>) {
        return run(sql);
      },
    };
    const drizzle = { marker: "drizzle" };
    const { postgresEntities } = await import("./postgres-entities.js");
    const entities = postgresEntities({ sql, drizzle: drizzle as never });

    await entities.workspaces.insert({ id: "workspace" } as never);
    await entities.workspaces.findById("workspace");
    await entities.workspaces.listAll();
    await entities.workspaces.update("workspace", { name: "Demo", autoDeletionDays: 30, updatedAt: "now" });
    await entities.apiKeys.insert({ id: "key" } as never);
    await entities.apiKeys.findById("key");
    await entities.apiKeys.findByPublicId("public");
    await entities.apiKeys.listForWorkspace("workspace");
    await entities.apiKeys.updateLastUsedAt("key", "now");
    await entities.apiKeys.updateRevokedAt("key", "now");
    await entities.members.insert({ id: "member" } as never);
    await entities.members.findById("member");
    await entities.members.findByWorkOsUserId("user");
    await entities.members.updateSeen("member", { email: "user@example.com", lastSeenAt: "now" });
    await entities.artifacts.insert({ id: "artifact" } as never);
    await entities.artifacts.findById("artifact", "workspace");
    await entities.artifacts.listFiltered("workspace", "active");
    await entities.artifacts.listWebPage({ workspaceId: "workspace", limit: 2 });
    await entities.artifacts.updateExpiry("artifact", "now");
    await entities.artifacts.markDeleted("artifact", "now");
    await entities.artifacts.listExpiring("now", 10);
    await entities.artifacts.expireBatch("now", ["artifact"]);
    await entities.artifactFiles.insert("artifact", "revision", { path: "index.html" } as never, "now");
    await entities.artifactFiles.listForArtifact("artifact");
    await entities.uploadSessions.insert({ id: "session" } as never);
    await entities.uploadSessions.findById("session", "workspace");
    await entities.uploadSessions.markFinalized("session", "now");
    await entities.uploadSessions.listExpiring("now", 10);
    await entities.uploadSessions.expireBatch("now", ["session"]);
    await entities.uploadSessionFiles.insert("session", { path: "index.html" } as never);
    await entities.uploadSessionFiles.listForSession("session");
    await entities.uploadSessionFiles.recordUpload({ sessionId: "session", path: "index.html", uploadedAt: "now" });
    await entities.platformLockdowns.findEffective("workspace", "workspace");
    await entities.platformLockdowns.listEffectivePage({ limit: 2 });
    await entities.platformLockdowns.insert({ id: "lockdown" } as never);
    await entities.platformLockdowns.markLifted("lockdown", { liftedAt: "now", liftedBy: "operator" });
    await entities.operationEvents.insert({ action: "cleanup.run" } as never);
    await entities.operationEvents.listAll();
    await entities.operationEvents.listForWorkspace("workspace");
    await entities.operationEvents.listWebPage({ workspaceId: "workspace", limit: 2 });
    await entities.operationEvents.listIdsForTarget("artifact");

    expect(calls.map((call) => call.name)).toEqual(
      expect.arrayContaining(["insert", "findById", "findByPublicId", "listForWorkspace", "listIdsForTarget"]),
    );
    expect(calls.every((call) => call.args[0] === drizzle)).toBe(true);
    expect(sqlCalls).toHaveLength(5);
    expect(sqlCalls[0]?.query).toContain("set status = 'deleted'");
    expect(sqlCalls[1]?.query).toContain("from artifacts");
    expect(sqlCalls[2]?.params).toEqual(["now", ["artifact"]]);
    expect(sqlCalls[3]?.query).toContain("from upload_sessions");
    expect(sqlCalls[4]?.query).toContain("update upload_sessions");
  });
});
