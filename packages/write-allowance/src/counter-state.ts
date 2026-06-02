import { dayWindowAlarmAt, secondsUntilNextUtcDay, utcDayKey } from "./day-window.js";

export type CounterSnapshot = {
  day: string;
  consumed: number;
  remaining: number;
  retry_after_seconds: number;
};

export type CounterDecision = CounterSnapshot & {
  allowed: boolean;
};

type StoredCounter = {
  day: string;
  consumed: number;
  reservations?: string[];
};

function reservationsForDay(stored: StoredCounter | undefined, day: string): string[] {
  return stored?.day === day ? (stored.reservations ?? []) : [];
}

export function readCounterState(stored: StoredCounter | undefined, limit: number, now = new Date()): CounterSnapshot {
  const day = utcDayKey(now);
  const consumed = stored?.day === day ? stored.consumed : 0;
  const remaining = Math.max(0, limit - consumed);
  return {
    day,
    consumed,
    remaining,
    retry_after_seconds: secondsUntilNextUtcDay(now),
  };
}

export function consumeCounterSlot(
  stored: StoredCounter | undefined,
  limit: number,
  now = new Date(),
  idempotencyKey?: string,
): { next: StoredCounter; decision: CounterDecision; alarmAt: number } {
  const snapshot = readCounterState(stored, limit, now);
  const reservations = reservationsForDay(stored, snapshot.day);
  if (idempotencyKey && reservations.includes(idempotencyKey)) {
    return {
      next: { day: snapshot.day, consumed: snapshot.consumed, reservations },
      decision: { ...snapshot, allowed: true },
      alarmAt: dayWindowAlarmAt(now),
    };
  }
  if (snapshot.remaining <= 0) {
    return {
      next: { day: snapshot.day, consumed: snapshot.consumed, reservations },
      decision: { ...snapshot, allowed: false },
      alarmAt: dayWindowAlarmAt(now),
    };
  }
  const consumed = snapshot.consumed + 1;
  const remaining = Math.max(0, limit - consumed);
  const nextReservations = idempotencyKey ? [...reservations, idempotencyKey] : reservations;
  return {
    next: {
      day: snapshot.day,
      consumed,
      ...(nextReservations.length > 0 ? { reservations: nextReservations } : {}),
    },
    decision: {
      day: snapshot.day,
      consumed,
      remaining,
      retry_after_seconds: snapshot.retry_after_seconds,
      allowed: true,
    },
    alarmAt: dayWindowAlarmAt(now),
  };
}
