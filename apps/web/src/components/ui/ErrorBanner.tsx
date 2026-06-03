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
        flex items-start gap-3 border-l-2 border-[hsl(var(--destructive))]
        bg-[hsl(var(--destructive)/0.07)] text-[hsl(var(--foreground))]
        rounded-r-[var(--radius-sm)] px-4 py-3
      "
    >
      <TriangleAlert size={17} className="mt-[2px] text-[hsl(var(--destructive))]" strokeWidth={1.75} />
      <div className="grid gap-1">
        <p className="font-semibold text-[14px]">{title}</p>
        <p className="text-[13px] text-[hsl(var(--muted))]">{message}</p>
        {requestId ? <p className="text-[11px] font-mono text-[hsl(var(--subtle))]">request_id: {requestId}</p> : null}
      </div>
    </div>
  );
}
