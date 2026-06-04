import { describe, expect, it } from "vitest";
import type { DrizzleDb } from "../postgres/drizzle.js";
import type { AccessLink } from "../types.js";
import { accessLinkQueries } from "./access-links.js";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("accessLinkQueries", () => {
  it("inserts, finds, lists, revokes, and updates expiration", async () => {
    const link = accessLinkEntity();
    const db = fakeDrizzle([
      [accessLinkRow()],
      [accessLinkRow()],
      [accessLinkRow()],
      [{ id: "al_test" }],
      [{ id: "al_test" }],
      [{ id: "al_test" }],
    ]);

    await accessLinkQueries.insert(db, link);
    await expect(accessLinkQueries.findById(db, "al_test", "workspace_1")).resolves.toMatchObject({
      public_id: "0123456789ABCDEF",
    });
    await expect(accessLinkQueries.findByPublicId(db, "0123456789ABCDEF")).resolves.toMatchObject({ id: "al_test" });
    await expect(accessLinkQueries.listForArtifact(db, "artifact_1")).resolves.toMatchObject([{ id: "al_test" }]);
    await expect(accessLinkQueries.revoke(db, "al_test", "2026-01-02T00:00:00.000Z")).resolves.toBe(true);
    await expect(accessLinkQueries.updateExpiresAt(db, "al_test", "2026-01-03T00:00:00.000Z")).resolves.toBe(true);
    await expect(accessLinkQueries.updateExpiresAt(db, "al_test", null)).resolves.toBe(true);
  });

  it("lists access links for a workspace", async () => {
    const db = fakeDrizzle([[accessLinkRow(), accessLinkRow({ id: "al_other" })]]);
    await expect(accessLinkQueries.listForWorkspace(db, "workspace_1")).resolves.toMatchObject([
      { id: "al_test" },
      { id: "al_other" },
    ]);
  });

  it("returns an empty list for a workspace with no access links", async () => {
    const db = fakeDrizzle([[]]);
    await expect(accessLinkQueries.listForWorkspace(db, "workspace_1")).resolves.toEqual([]);
  });

  it("maps nullable expiration and revocation timestamps", async () => {
    const db = fakeDrizzle([
      [
        accessLinkRow({
          expiresAt: now,
          revokedAt: now,
          revisionId: "rev_1",
          type: "revision",
        }),
      ],
    ]);
    await expect(accessLinkQueries.findById(db, "al_test")).resolves.toMatchObject({
      expires_at: "2026-01-01T00:00:00.000Z",
      revoked_at: "2026-01-01T00:00:00.000Z",
      revision_id: "rev_1",
      type: "revision",
    });
  });

  it("returns null or false for missing rows", async () => {
    const db = fakeDrizzle([[], [], [], [], [], []]);
    await expect(accessLinkQueries.findById(db, "missing")).resolves.toBeNull();
    await expect(accessLinkQueries.findByPublicId(db, "missing")).resolves.toBeNull();
    await expect(accessLinkQueries.listForArtifact(db, "artifact_1")).resolves.toEqual([]);
    await expect(accessLinkQueries.revoke(db, "missing", "2026-01-02T00:00:00.000Z")).resolves.toBe(false);
    await expect(accessLinkQueries.updateExpiresAt(db, "missing", null)).resolves.toBe(false);
  });
});

function accessLinkEntity(overrides: Partial<AccessLink> = {}): AccessLink {
  return {
    id: "al_test",
    workspace_id: "workspace_1",
    artifact_id: "artifact_1",
    revision_id: null,
    public_id: "0123456789ABCDEF",
    type: "share",
    scopes_bitmask: 7,
    expires_at: null,
    created_by_type: "api_key",
    created_by_id: "key_1",
    created_at: "2026-01-01T00:00:00.000Z",
    revoked_at: null,
    ...overrides,
  };
}

function accessLinkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "al_test",
    workspaceId: "workspace_1",
    artifactId: "artifact_1",
    revisionId: null,
    publicId: "0123456789ABCDEF",
    type: "share",
    scopesBitmask: 7,
    expiresAt: null,
    createdByType: "api_key",
    createdById: "key_1",
    createdAt: now,
    revokedAt: null,
    ...overrides,
  };
}

function fakeDrizzle(results: unknown[][]) {
  const writes: unknown[] = [];
  const nextRows = () => results.shift() ?? [];
  const chain = (readRows: (() => unknown[]) | null = null) => {
    let rows: unknown[] | undefined;
    const getRows = () => {
      rows ??= readRows ? readRows() : [];
      return rows;
    };
    return {
      from() {
        return this;
      },
      where() {
        return this;
      },
      orderBy() {
        return this;
      },
      limit(limit: number) {
        return Promise.resolve(getRows().slice(0, limit));
      },
      returning() {
        return Promise.resolve(getRows());
      },
      // biome-ignore lint/suspicious/noThenProperty: fake Drizzle query builder used in unit tests
      then(onFulfilled: (value: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve(getRows()).then(onFulfilled, onRejected);
      },
    };
  };

  const db = {
    writes,
    insert() {
      writes.push("insert");
      return { values: async () => undefined };
    },
    select() {
      return chain(nextRows);
    },
    update() {
      writes.push("update");
      return {
        set() {
          return chain(nextRows);
        },
      };
    },
  };

  return db as DrizzleDb & { writes: unknown[] };
}
