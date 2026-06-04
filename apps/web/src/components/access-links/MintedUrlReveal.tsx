import { Check, Copy, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";

type Props = {
  url: string;
  onDismiss: () => void;
};

// Renders a freshly minted Access Link Signed URL exactly once. The credential
// lives in the URL fragment; it is never persisted or re-rendered from storage,
// so dismissing or navigating away loses it permanently (re-mint for a new one).
export function MintedUrlReveal({ url, onDismiss }: Props) {
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
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 1200);
    } catch {
      // clipboard may be unavailable (insecure context / no gesture); the URL
      // stays visible for manual selection.
    }
  }, [url]);

  return (
    <div className="grid gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--accent)/0.3)] bg-[hsl(var(--accent-tint))] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow text-[hsl(var(--accent))]">Shown once · copied to clipboard</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss minted URL"
          className="text-[hsl(var(--subtle))] transition-colors hover:text-[hsl(var(--foreground))]"
        >
          <X size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[var(--radius-xs)] border border-[hsl(var(--rule))] bg-[hsl(var(--background))] px-2.5 py-1.5 font-mono text-[12px] text-[hsl(var(--foreground))]">
          {url}
        </code>
        <Button size="sm" variant="secondary" onClick={copy}>
          {copied ? (
            <Check size={14} strokeWidth={1.75} aria-hidden />
          ) : (
            <Copy size={14} strokeWidth={1.75} aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
