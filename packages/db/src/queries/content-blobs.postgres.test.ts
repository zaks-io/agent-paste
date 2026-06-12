import { describe, expect, it } from "vitest";
import { createDrizzleConnection } from "../postgres/drizzle.js";
import { contentBlobQueries } from "./content-blobs.js";

describe("contentBlobQueries on postgres-js drizzle", () => {
  it("listForReparent binds now as a string parameter", async () => {
    const params: unknown[] = [];
    const client = {
      options: { parsers: {}, serializers: {} },
      async unsafe(_sql: string, bound: unknown[] = []) {
        params.push(...bound);
        return [];
      },
    };
    const conn = createDrizzleConnection(client as never);
    const workspaceId = "11111111-1111-1111-1111-111111111111";
    const now = "2099-06-01T14:00:00.000Z";
    await contentBlobQueries.listForReparent(conn.drizzle, workspaceId, now);
    expect(params).toContain(workspaceId);
    expect(params).toContain(now);
    expect(params.some((value) => value instanceof Date)).toBe(false);
  });

  it("deleteUnreferenced binds now as a string parameter", async () => {
    const params: unknown[] = [];
    const client = {
      options: { parsers: {}, serializers: {} },
      async unsafe(_sql: string, bound: unknown[] = []) {
        params.push(...bound);
        return [];
      },
    };
    const conn = createDrizzleConnection(client as never);
    const now = "2099-06-01T14:00:00.000Z";
    await contentBlobQueries.deleteUnreferenced(conn.drizzle, { now, limit: 10 });
    expect(params).toContain(now);
    expect(params).toContain(10);
    expect(params.some((value) => value instanceof Date)).toBe(false);
  });
});
