import { useEffect, useState } from "react";
import {
  formatAbsoluteTime,
  formatRelativeTime,
  getRelativeTimeTickIntervalMs,
} from "../../lib/format";

type Props = {
  value: string | number | Date;
  className?: string;
};

// Renders the absolute timestamp on the server and the first client paint so the
// hydrated text matches the server byte-for-byte, then upgrades to a live relative
// string after mount. Rendering a Date.now()-derived relative string during SSR is
// what caused React hydration error #418 and left the whole app non-interactive.
export function RelativeTime({ value, className }: Props) {
  const iso = toIso(value);
  const absolute = formatAbsoluteTime(value);
  const [relative, setRelative] = useState<string | null>(null);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const tick = () => {
      setRelative(formatRelativeTime(value));
      const delay = getRelativeTimeTickIntervalMs(value);
      if (Number.isFinite(delay)) {
        timeoutId = setTimeout(tick, delay);
      }
    };

    tick();

    return () => clearTimeout(timeoutId);
  }, [value]);

  return (
    <time dateTime={iso} title={absolute} className={className} suppressHydrationWarning>
      {relative ?? absolute}
    </time>
  );
}

function toIso(value: string | number | Date): string | undefined {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
