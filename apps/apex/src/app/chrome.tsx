import { BRAND_MARK } from "@agent-paste/brand";
import { FOOTER, type FooterColumn, INSTALL_LINKS, SIGN_IN_URL, WORDMARK } from "../copy";

export function Wordmark({ small }: { small?: boolean }) {
  return (
    <span className={small ? "wordmark wordmark-sm" : "wordmark"}>
      agent
      <span className="wordmark-hyphen" aria-hidden="true">
        -
      </span>
      paste<span className="wordmark-tld">{WORDMARK.tld}</span>
    </span>
  );
}

// The single marketing header for every apex page: brand left, nav center,
// "Get started free" right, sticky. The "How it works"/"Features" links target
// the home sections by absolute anchor (/#how, /#features) so they resolve from
// docs/about/legal too, not just the home page.
export function Header({ billingEnabled }: { billingEnabled: boolean }) {
  return (
    <header className="topbar" id="topbar">
      <div className="wrap topbar-inner">
        <a className="brand" href="/" aria-label={`${WORDMARK.base}${WORDMARK.tld}`}>
          <Wordmark />
        </a>
        <nav className="head-center">
          <a className="head-link" href="/#how">
            How it works
          </a>
          <a className="head-link" href="/#features">
            Features
          </a>
          <a className="head-link" href="/docs">
            Docs
          </a>
          {billingEnabled ? (
            <a className="head-link" href="/pricing">
              Pricing
            </a>
          ) : null}
          <a className="head-link" href="/about">
            About
          </a>
        </nav>
        <div className="head-end">
          <button type="button" className="theme-toggle" id="theme-toggle" aria-label="Toggle light or dark theme">
            <span className="tt-icon" aria-hidden="true" />
            <span className="tt-label">Theme</span>
          </button>
          <a className="button button-primary button-sm" href={SIGN_IN_URL}>
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
      <p className="home-foot-heading">{column.heading}</p>
      <ul className="home-foot-list">
        {column.links.map((link) => (
          <li key={link.href}>
            <a className="home-foot-link foot-link" href={link.href}>
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
    <footer className="home-foot">
      <div className="wrap">
        <div className="home-foot-grid">
          <div className="home-foot-brand">
            <a className="brand" href="/" aria-label={`${WORDMARK.base}${WORDMARK.tld}`}>
              <img className="brand-mark" src={`/${BRAND_MARK}`} width="22" height="22" alt="" aria-hidden="true" />
              <Wordmark small />
            </a>
            <p className="home-foot-tag">
              The neutral hand-off layer for what your agent makes. Publish once, open it anywhere.
            </p>
          </div>
          {footerColumns(billingEnabled).map((column) => (
            <FooterCol key={column.heading} column={column} />
          ))}
        </div>
        <div className="home-foot-base">
          <span className="home-foot-tagline">where agents publish</span>
          <span className="home-foot-install">
            <span className="home-foot-install-label">install</span>
            {INSTALL_LINKS.map((link) => (
              <a key={link.href} className="home-foot-install-link" href={link.href}>
                {link.label}
              </a>
            ))}
          </span>
          <span className="home-foot-copy">© {new Date().getFullYear()} zaks-io</span>
        </div>
      </div>
    </footer>
  );
}
