const UNITS: ReadonlyArray<readonly [number, Intl.RelativeTimeFormatUnit]> = [
  [60, "seconds"],
  [60, "minutes"],
  [24, "hours"],
  [7, "days"],
  [4.345, "weeks"],
  [12, "months"],
  [Number.POSITIVE_INFINITY, "years"],
];

export function formatRelativeTime(input: Date | string | number): string {
  const date = input instanceof Date ? input : new Date(input);
  const diffSeconds = (Date.now() - date.getTime()) / 1000;
  const absSeconds = Math.abs(diffSeconds);

  if (absSeconds < 5) return "just now";

  let value = diffSeconds;
  let unit: Intl.RelativeTimeFormatUnit = "seconds";

  for (const [factor, nextUnit] of UNITS) {
    if (Math.abs(value) < factor) break;
    value /= factor;
    unit = nextUnit;
  }

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });
  return formatter.format(-Math.round(value), unit);
}

export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const raw = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  const exponent = Math.min(units.length - 1, Math.max(0, raw));
  const value = bytes / 1024 ** exponent;
  const formatted = exponent === 0 ? Math.round(value).toString() : value.toFixed(fractionDigits);
  return `${formatted} ${units[exponent]}`;
}

export function truncateId(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}
