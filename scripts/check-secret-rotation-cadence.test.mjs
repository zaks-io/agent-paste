import { describe, expect, it } from "vitest";

import { evaluateRotationCadence } from "./check-secret-rotation-cadence.mjs";

describe("secret rotation cadence", () => {
  it("treats an unknown completion date as overdue", () => {
    expect(evaluateRotationCadence({ maximumAgeDays: 90, signingKeys: { lastRotatedAt: null } })).toMatchObject({
      overdue: true,
    });
  });

  it("calculates the exact due date", () => {
    const record = { maximumAgeDays: 90, signingKeys: { lastRotatedAt: "2026-01-01T00:00:00.000Z" } };

    expect(evaluateRotationCadence(record, new Date("2026-03-31T23:59:59.999Z"))).toEqual({
      overdue: false,
      dueAt: "2026-04-01T00:00:00.000Z",
      reason: "Production signing keys are due for rotation by 2026-04-01T00:00:00.000Z.",
    });
    expect(evaluateRotationCadence(record, new Date("2026-04-01T00:00:00.000Z"))).toMatchObject({ overdue: true });
  });

  it("rejects ambiguous timestamps", () => {
    expect(() => evaluateRotationCadence({ maximumAgeDays: 90, signingKeys: { lastRotatedAt: "2026-01-01" } })).toThrow(
      /canonical RFC3339/,
    );
  });
});
