import { Button } from "@agent-paste/ui";
import { Check, Copy, X } from "lucide-react";
import { useClipboardCopy } from "../../lib/use-clipboard-copy";

type Props = {
  url: string;
  onDismiss: () => void;
};

// Renders a freshly minted Access Link Signed URL exactly once. The credential
// lives in the URL fragment; it is never persisted or re-rendered from storage,
// so dismissing or navigating away loses it permanently (re-mint for a new one).
export function MintedUrlReveal({ url, onDismiss }: Props) {
  const { copied, copy } = useClipboardCopy(url, 1200);

  return (
    <div className="grid gap-2 rounded-sm border border-accent/30 bg-accent-tint p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow text-accent">Shown once · copied to clipboard</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss minted URL"
          className="text-subtle transition-colors hover:text-foreground"
        >
          <X size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xs border border-rule bg-background px-2 py-2 font-mono text-xs text-foreground">
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
