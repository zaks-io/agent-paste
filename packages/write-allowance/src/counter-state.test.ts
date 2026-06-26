import { describe, expect, it } from "vitest";
import { consumeCounterSlot, readCounterState, releaseCounterReservation } from "./counter-state.js";

describe("write allowance counter", () => {
  const now = new Date("2026-06-02T12:00:00.000Z");

  it("starts empty for a new UTC day", () => {
    expect(readCounterState(undefined, 20, now)).toMatchObject({
      day: "2026-06-02",
      consumed: 0,
      remaining: 20,
    });
  });

  it("consumes slots until the daily limit is reached", () => {
    let stored: { day: string; consumed: number } | undefined;
    for (let index = 0; index < 20; index += 1) {
      const outcome = consumeCounterSlot(stored, 20, now);
      expect(outcome.decision.allowed).toBe(true);
      stored = outcome.next;
    }
    const blocked = consumeCounterSlot(stored, 20, now);
    expect(blocked.decision).toMatchObject({ allowed: false, consumed: 20, remaining: 0 });
  });

  it("resets when the stored day rolls forward", () => {
    const stored = { day: "2026-06-01", consumed: 20 };
    expect(readCounterState(stored, 20, now)).toMatchObject({ consumed: 0, remaining: 20 });
  });

  it("does not consume twice for the same idempotency key on the same day", () => {
    let stored: { day: string; consumed: number; reservations?: string[] } | undefined;
    const idempotencyKey = "idem-fixture-reservation-one";
    const first = consumeCounterSlot(stored, 1, now, idempotencyKey);
    expect(first.decision.allowed).toBe(true);
    stored = first.next;
    const blocked = consumeCounterSlot(stored, 1, now, "idem-fixture-reservation-two");
    expect(blocked.decision.allowed).toBe(false);
    const replay = consumeCounterSlot(stored, 1, now, idempotencyKey);
    expect(replay.decision).toMatchObject({ allowed: true, consumed: 1, remaining: 0 });
    expect(replay.next).toEqual({ day: "2026-06-02", consumed: 1, reservations: [idempotencyKey] });
  });

  it("releases a consumed reservation without double-refunding", () => {
    const idempotencyKey = "idem-fixture-reservation-one";
    const stored = consumeCounterSlot(undefined, 1, now, idempotencyKey).next;
    const released = releaseCounterReservation(stored, idempotencyKey, now);
    expect(released).toMatchObject({ released: true });
    expect(released.next).toEqual({ day: "2026-06-02", consumed: 0 });
    expect(readCounterState(released.next, 1, now)).toMatchObject({ consumed: 0, remaining: 1 });
    const again = releaseCounterReservation(released.next, idempotencyKey, now);
    expect(again.released).toBe(false);
    expect(readCounterState(again.next, 1, now)).toMatchObject({ consumed: 0, remaining: 1 });
  });

  it("releases only the matching reservation", () => {
    const first = consumeCounterSlot(undefined, 3, now, "idem-one").next;
    const second = consumeCounterSlot(first, 3, now, "idem-two").next;
    const released = releaseCounterReservation(second, "idem-one", now);
    expect(released).toMatchObject({ released: true });
    expect(released.next).toEqual({ day: "2026-06-02", consumed: 1, reservations: ["idem-two"] });
  });

  it("does not refund a stale-day reservation", () => {
    const stale = { day: "2026-06-01", consumed: 1, reservations: ["idem-one"] };
    const released = releaseCounterReservation(stale, "idem-one", now);
    expect(released).toMatchObject({
      next: { day: "2026-06-02", consumed: 0 },
      released: false,
    });
  });
});
