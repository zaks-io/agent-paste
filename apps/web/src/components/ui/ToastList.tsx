import { cn } from "@agent-paste/ui";
import { TriangleAlert, X } from "lucide-react";
import type { Toast } from "./toast-context";

type Props = {
  toasts: readonly Toast[];
  onDismiss: (id: string) => void;
};

export function ToastList({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <section
      className="fixed bottom-4 right-4 z-50 grid w-[min(380px,calc(100vw-2rem))] gap-2"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </section>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const isError = toast.tone === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-[var(--radius-md)] border px-4 py-3 shadow-lg",
        "bg-[hsl(var(--surface))]",
        isError ? "border-[hsl(var(--destructive)/0.24)]" : "border-[hsl(var(--success)/0.24)]",
      )}
    >
      {isError ? (
        <TriangleAlert size={18} className="mt-[2px] text-[hsl(var(--destructive))]" strokeWidth={1.5} />
      ) : null}
      <div className="grid flex-1 gap-1">
        <p className="text-[14px] font-semibold">{toast.title}</p>
        <p className="text-[13px] text-[hsl(var(--muted))]">
          {toast.code ? <span className="font-mono text-[12px]">{toast.code}: </span> : null}
          {toast.message}
        </p>
        {toast.requestId ? (
          <a
            href={`/audit?request_id=${encodeURIComponent(toast.requestId)}`}
            className="text-[12px] text-[hsl(var(--accent))] underline-offset-4 hover:underline"
          >
            View in audit log
          </a>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        className="rounded-[3px] p-[2px] text-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
      >
        <X size={15} strokeWidth={1.5} />
      </button>
    </div>
  );
}
