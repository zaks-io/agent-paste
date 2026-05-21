import { describe, expect, it } from "vitest";
import { cleanupExpired, createIdempotencyStore, createOperationEvent, runIdempotent } from "./index";

describe("command helpers", () => {
  it("creates operation events", () => {
    expect(
      createOperationEvent({
        operationId: "op_1",
        type: "artifact.write",
        status: "succeeded",
        now: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toMatchObject({
      id: "op_1:artifact.write:2026-01-01T00:00:00.000Z",
      operationId: "op_1",
      status: "succeeded",
    });
  });

  it("reuses idempotent results for matching fingerprints", () => {
    const store = createIdempotencyStore<number>();
    let runs = 0;
    const first = runIdempotent(store, { key: "k", fingerprint: "f", run: () => (runs += 1) });
    const second = runIdempotent(store, { key: "k", fingerprint: "f", run: () => (runs += 1) });

    expect(first).toEqual({ hit: false, value: 1 });
    expect(second).toEqual({ hit: true, value: 1 });
  });

  it("cleans up expired items", () => {
    expect(
      cleanupExpired(
        [{ id: "old", expiresAt: "2026-01-01T00:00:00.000Z" }, { id: "fresh" }],
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toEqual({
      removed: [{ id: "old", expiresAt: "2026-01-01T00:00:00.000Z" }],
      retained: [{ id: "fresh" }],
    });
  });
});
