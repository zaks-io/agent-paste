import type { AnchorHTMLAttributes, Ref } from "react";
import { type ButtonSize, type ButtonVariant, buttonClasses } from "./buttonClasses";

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // React 19: ref is a regular prop, no forwardRef needed.
  ref?: Ref<HTMLAnchorElement>;
};

/**
 * An <a> that wears the shared Button look. Use for CTAs that navigate (sign-in,
 * install, docs) — a <button> can't be an anchor, so these previously re-declared
 * the accent-fill class string inline in every apex page. They all compose this
 * now, so the link CTA and the button CTA share one definition.
 */
export function ButtonAnchor({ className, variant = "primary", size = "md", children, ref, ...rest }: Props) {
  return (
    <a ref={ref} className={buttonClasses(variant, size, className)} {...rest}>
      {children}
    </a>
  );
}
