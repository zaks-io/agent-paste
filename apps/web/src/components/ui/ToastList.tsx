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
        "flex items-start gap-3 rounded-md border px-4 py-3 shadow-lg",
        "bg-surface",
        isError ? "border-destructive/24" : "border-success/24",
      )}
    >
      {isError ? <TriangleAlert size={18} className="mt-1 text-destructive" strokeWidth={1.5} /> : null}
      <div className="grid flex-1 gap-1">
        <p className="text-base font-semibold">{toast.title}</p>
        <p className="text-sm text-muted">
          {toast.code ? <span className="font-mono text-xs">{toast.code}: </span> : null}
          {toast.message}
        </p>
        {toast.requestId ? (
          <a
            href={`/audit?request_id=${encodeURIComponent(toast.requestId)}`}
            className="text-xs text-accent underline-offset-4 hover:underline"
          >
            View in audit log
          </a>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        className="rounded-[3px] p-1 text-muted hover:text-foreground"
      >
        <X size={15} strokeWidth={1.5} />
      </button>
    </div>
  );
}
