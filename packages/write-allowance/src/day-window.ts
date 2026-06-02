const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function secondsUntilNextUtcDay(now = new Date()): number {
  const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((nextDay - now.getTime()) / 1000));
}

export function dayWindowAlarmAt(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

export { MS_PER_DAY };
