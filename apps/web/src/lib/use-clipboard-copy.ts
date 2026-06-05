import { useCallback, useEffect, useRef, useState } from "react";

/** Copies `text` to the clipboard and briefly sets `copied` to true. */
export function useClipboardCopy(text: string, resetMs = 700) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, resetMs);
    } catch {
      // clipboard may be unavailable (no user gesture / insecure context); fail silently
    }
  }, [text, resetMs]);

  return { copied, copy };
}
