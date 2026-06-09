import type { ButtonHTMLAttributes, Ref } from "react";
import { type ButtonSize, type ButtonVariant, buttonClasses } from "./buttonClasses";

export type { ButtonSize, ButtonVariant } from "./buttonClasses";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  // React 19: ref is a regular prop, no forwardRef needed.
  ref?: Ref<HTMLButtonElement>;
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading,
  children,
  disabled,
  type,
  ref,
  ...rest
}: Props) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      data-loading={loading ? "true" : undefined}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {loading ? (
        <>
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
          />
          <span className="sr-only">Loading</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
