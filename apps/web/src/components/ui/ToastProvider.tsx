import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToastList } from "./ToastList";
import { type Toast, ToastContext, type ToastInput } from "./toast-context";

const AUTO_DISMISS_MS = 8000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { ...input, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      );
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss, toasts }), [push, dismiss, toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastList toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
