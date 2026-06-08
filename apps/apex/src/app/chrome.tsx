import { Wordmark } from "@agent-paste/ui";
import { FOOTER, type FooterColumn, INSTALL_LINKS, SIGN_IN_URL, WORDMARK } from "../copy";

const WRAP = "mx-auto max-w-[1240px] px-[clamp(20px,4vw,72px)]";

// Get-started CTA. The shared Button renders a <button>; the header CTA must be
// an anchor, so we reproduce the primary/sm Button utilities on an <a> verbatim.
const CTA =
  "inline-flex items-center justify-center gap-2 select-none font-medium whitespace-nowrap " +
  "rounded-[var(--radius-sm)] h-[30px] px-[12px] text-[12.5px] " +
  "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--accent-dim))] " +
  "transition-[background-color,color,border-color] duration-150 ease-[var(--ease-out)] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))]";

const NAV_LINK =
  "relative font-mono text-[12.5px] tracking-[0.01em] py-[4px] " +
  "text-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] " +
  "transition-colors duration-200 ease-[var(--ease-out)] " +
  "after:content-[''] after:absolute after:left-0 after:bottom-0 after:w-full after:h-px " +
  "after:bg-[hsl(var(--accent))] after:origin-left after:scale-x-0 hover:after:scale-x-100 " +
  "after:transition-transform after:duration-[280ms] after:ease-[var(--ease-out)]";

// The single marketing header for every apex page: brand left, nav center,
// "Get started free" right, sticky. The "How it works"/"Features" links target
// the home sections by absolute anchor (/#how, /#features) so they resolve from
// docs/about/legal too, not just the home page.
export function Header({ billingEnabled }: { billingEnabled: boolean }) {
  return (
    <header
      id="topbar"
      className={
        "sticky top-0 z-50 border-b border-transparent " +
        "transition-[background-color,border-color,backdrop-filter] duration-200 ease-[var(--ease-out)] " +
        "data-[stuck=true]:bg-[hsl(var(--background)/0.82)] data-[stuck=true]:backdrop-blur-[14px] " +
        "data-[stuck=true]:backdrop-saturate-[140%] data-[stuck=true]:border-b-[hsl(var(--rule))]"
      }
    >
      <div className={`${WRAP} grid grid-cols-[1fr_auto_1fr] items-center gap-x-[12px] h-[var(--head-h)]`}>
        <a
          className="justify-self-start inline-flex items-center gap-[8px]"
          href="/"
          aria-label={`${WORDMARK.base}${WORDMARK.tld}`}
        >
          <Wordmark withMark={false} />
        </a>
        <nav className="hidden justify-self-center items-center gap-[clamp(14px,1.6vw,26px)] min-[880px]:inline-flex">
          <a className={NAV_LINK} href="/#how">
            How it works
          </a>
          <a className={NAV_LINK} href="/#features">
            Features
          </a>
          <a className={NAV_LINK} href="/docs">
            Docs
          </a>
          {billingEnabled ? (
            <a className={NAV_LINK} href="/pricing">
              Pricing
            </a>
          ) : null}
          <a className={NAV_LINK} href="/about">
            About
          </a>
        </nav>
        <div className="justify-self-end inline-flex items-center gap-[14px]">
          <button
            type="button"
            id="theme-toggle"
            aria-label="Toggle light or dark theme"
            className={
              "inline-flex items-center gap-[7px] h-[32px] px-[10px] " +
              "font-mono text-[11.5px] tracking-[0.02em] " +
              "text-[hsl(var(--muted))] bg-transparent border border-[hsl(var(--rule))] " +
              "rounded-[var(--radius-xs)] cursor-pointer " +
              "transition-[color,border-color] duration-[120ms] ease-[var(--ease-out)] " +
              "hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--rule-strong))]"
            }
          >
            <span className="tt-icon [&>svg]:block [&>svg]:w-[13px] [&>svg]:h-[13px]" aria-hidden="true" />
            <span className="tt-label min-w-[30px] text-left max-[560px]:hidden">Theme</span>
          </button>
          <a className={CTA} href={SIGN_IN_URL}>
            Get started free
          </a>
        </div>
      </div>
    </header>
  );
}

function footerColumns(billingEnabled: boolean): FooterColumn[] {
  if (!billingEnabled) {
    return FOOTER;
  }
  return FOOTER.map((column) =>
    column.heading === "Product"
      ? {
          ...column,
          links: [{ label: "Pricing", href: "/pricing" }, ...column.links],
        }
      : column,
  );
}

function FooterCol({ column }: { column: FooterColumn }) {
  return (
    <div>
      <p className="font-mono text-[11px] font-medium tracking-[0.08em] uppercase text-[hsl(var(--subtle))] mb-[14px]">
        {column.heading}
      </p>
      <ul className="grid gap-[9px]">
        {column.links.map((link) => (
          <li key={link.href}>
            <a
              className="text-[13.5px] text-[hsl(var(--muted))] hover:text-[hsl(var(--accent))] transition-colors duration-[120ms] ease-[var(--ease-out)]"
              href={link.href}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer({ billingEnabled }: { billingEnabled: boolean }) {
  return (
    <footer className="border-t border-[hsl(var(--rule))] pt-[56px] pb-[40px]">
      <div className={WRAP}>
        <div className="grid grid-cols-1 gap-[40px] min-[640px]:grid-cols-[1.4fr_repeat(4,1fr)] min-[640px]:gap-x-[40px] min-[640px]:gap-y-[48px]">
          <div className="grid gap-[14px] content-start max-w-[32ch]">
            <a className="inline-flex items-center gap-[8px]" href="/" aria-label={`${WORDMARK.base}${WORDMARK.tld}`}>
              <Wordmark small />
            </a>
            <p className="text-[13.5px] leading-[1.55] text-[hsl(var(--subtle))]">
              The neutral hand-off layer for what your agent makes. Publish once, open it anywhere.
            </p>
          </div>
          {footerColumns(billingEnabled).map((column) => (
            <FooterCol key={column.heading} column={column} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-[12px] mt-[48px] pt-[28px] border-t border-[hsl(var(--rule))]">
          <span className="font-mono text-[11.5px] text-[hsl(var(--faint))]">where agents publish</span>
          <span className="flex flex-wrap items-baseline gap-[14px] ml-auto">
            <span className="font-mono text-[11px] tracking-[0.04em] text-[hsl(var(--faint)/0.7)]">install</span>
            {INSTALL_LINKS.map((link) => (
              <a
                key={link.href}
                className="font-mono text-[11px] text-[hsl(var(--faint))] hover:text-[hsl(var(--subtle))] transition-colors duration-[120ms] ease-[var(--ease-out)]"
                href={link.href}
              >
                {link.label}
              </a>
            ))}
          </span>
          <span className="font-mono text-[11.5px] text-[hsl(var(--subtle))]">
            © {new Date().getFullYear()} zaks-io
          </span>
        </div>
      </div>
    </footer>
  );
}
