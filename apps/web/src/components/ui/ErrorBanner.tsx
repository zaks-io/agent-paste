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
        flex items-start gap-3 border border-[hsl(var(--destructive)/0.24)]
        bg-[hsl(var(--destructive)/0.06)] text-[hsl(var(--foreground))]
        rounded-[var(--radius-md)] px-4 py-3
      "
    >
      <TriangleAlert size={18} className="mt-[2px] text-[hsl(var(--destructive))]" strokeWidth={1.5} />
      <div className="grid gap-1">
        <p className="font-semibold text-[14px]">{title}</p>
        <p className="text-[13px] text-[hsl(var(--muted))]">{message}</p>
        {requestId ? <p className="text-[11px] font-mono text-[hsl(var(--subtle))]">request_id: {requestId}</p> : null}
      </div>
    </div>
  );
}
