import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export function ErrorBanner({
  title,
  message,
  requestId,
}: {
  title: string;
  message: ReactNode;
  requestId?: string | undefined;
}) {
  return (
    <div
      role="alert"
      className="
        flex items-start gap-3 border-l-2 border-destructive
        bg-destructive/7 text-foreground
        rounded-r-[var(--radius-sm)] px-4 py-3
      "
    >
      <TriangleAlert size={17} className="mt-1 text-destructive" strokeWidth={1.75} />
      <div className="grid gap-1">
        <p className="font-semibold text-base">{title}</p>
        <p className="text-sm text-muted">{message}</p>
        {requestId ? <p className="text-mono-sm font-mono text-subtle">request_id: {requestId}</p> : null}
      </div>
    </div>
  );
}
