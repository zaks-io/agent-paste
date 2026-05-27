import { describe, expect, it } from "vitest";
import type { DrizzleDb } from "../postgres/drizzle.js";
import type { Revision } from "../types.js";
import { revisionQueries, toRevisionSummary } from "./revisions.js";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("revisionQueries", () => {
  it("inserts, finds, lists, numbers, and publishes revisions", async () => {
    const draft = revisionEntity({ id: "rev_draft", status: "draft", revision_number: null, published_at: null });
    const published = revisionEntity({ id: "rev_pub", status: "published", revision_number: 1 });
    const db = fakeDrizzle([
      [revisionRow({ id: "rev_draft", status: "draft", revisionNumber: null, publishedAt: null })],
      [revisionRow({ id: "rev_draft", status: "draft", revisionNumber: null, publishedAt: null })],
      [revisionRow({ id: "rev_draft", status: "draft", revisionNumber: null, publishedAt: null })],
      [revisionRow({ id: "rev_pub", status: "published", revisionNumber: 1 })],
      [{ max: 1 }],
      [{ id: "rev_draft" }],
      [revisionRow({ id: "rev_draft", status: "published", revisionNumber: 2, publishedAt: now })],
    ]);

    await revisionQueries.insert(db, draft);
    await expect(revisionQueries.findById(db, "rev_draft", "workspace_1")).resolves.toMatchObject({
      id: "rev_draft",
      status: "draft",
    });
    await expect(revisionQueries.findById(db, "rev_draft")).resolves.toMatchObject({ id: "rev_draft" });
    await expect(revisionQueries.findDraftForArtifact(db, "artifact_1")).resolves.toMatchObject({
      id: "rev_draft",
    });
    await expect(revisionQueries.listForArtifact(db, "artifact_1")).resolves.toMatchObject([
      { id: "rev_pub", revision_number: 1 },
    ]);
    await expect(revisionQueries.nextRevisionNumber(db, "artifact_1")).resolves.toBe(2);
    await expect(
      revisionQueries.publish(db, {
        revisionId: "rev_draft",
        revisionNumber: 2,
        publishedAt: "2026-01-02T00:00:00.000Z",
      }),
    ).resolves.toBe(true);
    await expect(revisionQueries.findById(db, "rev_draft", "workspace_1")).resolves.toMatchObject({
      status: "published",
      revision_number: 2,
    });
    expect(toRevisionSummary(published)).toMatchObject({
      revision_id: "rev_pub",
      revision_number: 1,
      status: "published",
    });
    expect(db.writes.length).toBeGreaterThan(0);
  });

  it("returns null or false for missing rows", async () => {
    const db = fakeDrizzle([[], [], [], [{ max: 0 }], []]);
    await expect(revisionQueries.findById(db, "missing")).resolves.toBeNull();
    await expect(revisionQueries.findDraftForArtifact(db, "artifact_1")).resolves.toBeNull();
    await expect(revisionQueries.listForArtifact(db, "artifact_1")).resolves.toEqual([]);
    await expect(revisionQueries.nextRevisionNumber(db, "artifact_1")).resolves.toBe(1);
    await expect(
      revisionQueries.publish(db, {
        revisionId: "missing",
        revisionNumber: 1,
        publishedAt: "2026-01-02T00:00:00.000Z",
      }),
    ).resolves.toBe(false);
  });
});

function revisionEntity(overrides: Partial<Revision> = {}): Revision {
  return {
    id: "rev_pub",
    workspace_id: "workspace_1",
    artifact_id: "artifact_1",
    revision_number: 1,
    status: "published",
    entrypoint: "index.html",
    render_mode: "html",
    file_count: 1,
    size_bytes: 12,
    bundle_status: "disabled",
    bundle_status_updated_at: null,
    bundle_size_bytes: null,
    bytes_purge_enqueued_at: null,
    created_by_api_key_id: "key_1",
    created_at: "2026-01-01T00:00:00.000Z",
    published_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function revisionRow(
  overrides: Partial<{
    id: string;
    status: string;
    revisionNumber: number | null;
    publishedAt: Date | null;
    bundleStatusUpdatedAt: Date | null;
    bytesPurgeEnqueuedAt: Date | null;
  }> = {},
) {
  return {
    id: "rev_pub",
    workspaceId: "workspace_1",
    artifactId: "artifact_1",
    revisionNumber: 1,
    status: "published",
    entrypoint: "index.html",
    renderMode: "html",
    fileCount: 1,
    sizeBytes: 12,
    bundleStatus: "disabled",
    bundleStatusUpdatedAt: null,
    bytesPurgeEnqueuedAt: null,
    createdByApiKeyId: "key_1",
    createdAt: now,
    publishedAt: now,
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
