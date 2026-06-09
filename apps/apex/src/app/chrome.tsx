import { ButtonAnchor, THEME_ICON_CLASS, THEME_TOGGLE_CLASS, Wordmark } from "@agent-paste/ui";
import { FOOTER, type FooterColumn, INSTALL_LINKS, SIGN_IN_URL, WORDMARK } from "../copy";

// One wrapper width for topbar + footer, straight from the mockup: 1280px max,
// fluid clamp gutter.
const WRAP = "mx-auto max-w-[1280px] px-[clamp(20px,4vw,72px)]";

// .nav a — dim link with an accent underline that wipes in from the left on hover
// (the mockup's signature interaction). Colors are theme utilities; the underline
// transform/easing stay arbitrary (no token for them).
const NAV_LINK =
  "relative text-base text-subtle py-1 " +
  "transition-colors duration-200 ease-out hover:text-foreground " +
  "after:content-[''] after:absolute after:left-0 after:bottom-0 after:w-full after:h-px " +
  "after:bg-accent after:origin-left after:scale-x-0 hover:after:scale-x-100 " +
  "after:transition-transform after:duration-[280ms] after:ease-[cubic-bezier(.2,.7,.2,1)]";

// A footer column link: dim, brightens to the accent on hover (a small accent
// splash on every footer link).
const FOOT_LINK = "text-base text-muted hover:text-accent transition-colors duration-[120ms] ease-out";

// The single marketing header for every apex page. Mockup .topbar: 60px,
// translucent canvas, hairline bottom, sticky. Brand left, nav + theme chip right.
// One accent only — no swatch picker (no client handler; style guide bans
// multiple accents).
export function Header({ billingEnabled }: { billingEnabled: boolean }) {
  return (
    <header id="topbar" className="sticky top-0 z-50 bg-background/88 backdrop-blur-[10px] border-b border-rule">
      <div className={`${WRAP} flex h-[60px] items-center justify-between gap-6`}>
        <a className="inline-flex items-center" href="/" aria-label={`${WORDMARK.base}${WORDMARK.tld}`}>
          <Wordmark withMark={false} />
        </a>
        <div className="flex items-center gap-[clamp(14px,2vw,30px)]">
          <nav className="hidden items-center gap-[clamp(14px,1.6vw,26px)] min-[640px]:flex" aria-label="Primary">
            <a className={NAV_LINK} href="/#how">
              How it works
            </a>
            <a className={NAV_LINK} href="/#features">
              Why
            </a>
            <a className={NAV_LINK} href="/docs">
              Docs
            </a>
            {billingEnabled ? (
              <a className={NAV_LINK} href="/pricing">
                Pricing
              </a>
            ) : null}
          </nav>
          {/* The shared header toggle. Look (class + icons + cycle) comes from
              @agent-paste/ui so it is identical to the dashboard's; the framework-
              free client.ts script paints the icon + drives the cycle on click. */}
          <button type="button" id="theme-toggle" aria-label="Toggle theme" className={THEME_TOGGLE_CLASS}>
            <span className={`tt-icon ${THEME_ICON_CLASS}`} aria-hidden="true" />
          </button>
          <ButtonAnchor size="sm" className="whitespace-nowrap rounded-xs" href={SIGN_IN_URL}>
            Get started
          </ButtonAnchor>
        </div>
      </div>
    </header>
  );
}

// Inject the Pricing link into the Product column only when billing is on, so the
// pricing route appears in the footer (and the render contract for >=2 /pricing
// hrefs holds) without it leaking into the no-billing build.
function footerColumns(billingEnabled: boolean): FooterColumn[] {
  if (!billingEnabled) {
    return FOOTER;
  }
  return FOOTER.map((column) =>
    column.heading === "Product"
      ? { ...column, links: [{ label: "Pricing", href: "/pricing" }, ...column.links] }
      : column,
  );
}

function FooterCol({ column }: { column: FooterColumn }) {
  return (
    <div>
      <p className="font-mono text-mono-sm font-medium tracking-wider uppercase text-subtle mb-4">{column.heading}</p>
      <ul className="grid gap-2">
        {column.links.map((link) => (
          <li key={link.href}>
            <a className={FOOT_LINK} href={link.href}>
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The single marketing footer for every apex page: a wordmark + blurb column then
// four link columns (Product / For agents / Project / Legal), with an install +
// legal base row. Driven by FOOTER + INSTALL_LINKS so it cannot drift from copy.ts;
// it also carries every render-contract href (docs/about/how-it-works/legal/agents
// twins/repo/install scripts) on every page.
export function Footer({ billingEnabled }: { billingEnabled: boolean }) {
  return (
    <footer className="border-t border-rule pt-12 pb-10">
      <div className={WRAP}>
        <div className="grid grid-cols-1 gap-10 min-[640px]:grid-cols-[1.4fr_repeat(4,1fr)] min-[640px]:gap-x-10 min-[640px]:gap-y-12">
          <div className="grid gap-4 content-start max-w-[32ch]">
            <a className="inline-flex items-center gap-2" href="/" aria-label={`${WORDMARK.base}${WORDMARK.tld}`}>
              <Wordmark small />
            </a>
            <p className="text-base leading-relaxed text-subtle">
              The neutral hand-off layer for what your agent makes. Publish once, open it anywhere.
            </p>
          </div>
          {footerColumns(billingEnabled).map((column) => (
            <FooterCol key={column.heading} column={column} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-12 pt-8 border-t border-rule">
          <span className="font-mono text-mono-sm text-faint">where agents publish</span>
          <span className="flex flex-wrap items-baseline gap-4 ml-auto">
            <span className="font-mono text-mono-sm tracking-wide text-faint/70">install</span>
            {INSTALL_LINKS.map((link) => (
              <a
                key={link.href}
                className="font-mono text-mono-sm text-faint hover:text-accent transition-colors duration-[120ms] ease-out"
                href={link.href}
              >
                {link.label}
              </a>
            ))}
          </span>
          <span className="font-mono text-mono-sm text-subtle">Apache-2.0 (c) zaks-io</span>
        </div>
      </div>
    </footer>
  );
}
