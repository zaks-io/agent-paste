import { createContext, useContext } from "react";

export type Toast = {
  id: string;
  tone: "error" | "success";
  title: string;
  message: string;
  code?: string | undefined;
  requestId?: string | undefined;
};

export type ToastInput = Omit<Toast, "id">;

export type ToastContextValue = {
  push: (toast: ToastInput) => void;
  dismiss: (id: string) => void;
  toasts: readonly Toast[];
};

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

type ApiErrorLike = { code: string; message: string; requestId?: string | undefined };

export function errorToast(title: string, error: ApiErrorLike): ToastInput {
  return { tone: "error", title, message: error.message, code: error.code, requestId: error.requestId };
}
