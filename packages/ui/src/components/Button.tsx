import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import { type ButtonSize, type ButtonVariant, buttonClasses } from "./buttonClasses";

export type { ButtonSize, ButtonVariant } from "./buttonClasses";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = "primary", size = "md", loading, children, disabled, type, ...rest },
  ref,
) {
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
});
