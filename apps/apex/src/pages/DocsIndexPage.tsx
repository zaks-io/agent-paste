import { DOCS_PAGES, docsHtmlPath } from "../docs/registry";

const DOCS_DESCRIPTION =
  "Official agent-paste usage docs covering install, auth, publish, Artifacts, Access Links, billing, REST, MCP, limits, and safety.";

// Mirrors the shared Button's composed utilities (size="lg") so these anchors
// match the design-system button. primary = accent fill; secondary = ghost.
const BUTTON_BASE =
  "inline-flex select-none items-center justify-center gap-2 rounded-[var(--radius-sm)] font-medium " +
  "transition-[background-color,color,border-color] duration-150 ease-[var(--ease-out)] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] " +
  "h-[40px] px-[18px] text-[14px]";
const BUTTON_PRIMARY = `${BUTTON_BASE} bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--accent-dim))]`;
const BUTTON_GHOST = `${BUTTON_BASE} border border-[hsl(var(--rule-strong))] bg-transparent text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-2))]`;

export function DocsIndexPage() {
  return (
    <main>
      <div className="flex flex-col gap-[clamp(40px,6vh,56px)]">
        <section className="flex flex-col items-start gap-[18px] border-b border-[hsl(var(--rule))] pb-[clamp(32px,5vh,48px)]">
          <p className="m-0 inline-flex items-center gap-[9px] font-mono text-[11.5px] font-medium uppercase leading-none tracking-[0.16em] text-[hsl(var(--subtle))]">
            Docs
          </p>
          <h1 className="m-0 max-w-[18ch] font-display text-[clamp(34px,5.2vw,54px)] font-extrabold leading-[1.04] tracking-[-0.03em] text-balance text-[hsl(var(--foreground))] [font-feature-settings:'ss01']">
            Use agent-paste
          </h1>
          <p className="m-0 max-w-[60ch] text-[clamp(16px,1.4vw,18px)] leading-[1.6] text-[hsl(var(--muted))]">
            {DOCS_DESCRIPTION}
          </p>
          <div className="flex flex-wrap gap-x-[14px] gap-y-[10px]">
            <a className={BUTTON_PRIMARY} href="/docs.md">
              Markdown index
            </a>
            <a className={BUTTON_GHOST} href="/llms-full.txt">
              llms-full.txt
            </a>
          </div>
        </section>
        <section
          className="grid grid-cols-1 gap-[12px] [@media(min-width:720px)]:grid-cols-2"
          aria-label="Documentation pages"
        >
          {DOCS_PAGES.map((page) => (
            <a
              className="grid min-h-[132px] gap-[8px] rounded-[var(--radius-sm)] border border-[hsl(var(--rule))] bg-[hsl(var(--surface))] p-[18px] transition-[border-color,background-color] duration-[80ms] ease-[var(--ease-out)] hover:border-[hsl(var(--rule-strong))] hover:bg-[hsl(var(--surface-2))]"
              href={docsHtmlPath(page)}
              key={page.slug}
            >
              <span className="font-display text-[18px] font-semibold leading-[1.25] tracking-[-0.012em] text-[hsl(var(--foreground))]">
                {page.title}
              </span>
              <span className="text-[14px] leading-[1.55] text-[hsl(var(--muted))]">{page.summary}</span>
            </a>
          ))}
        </section>
      </div>
    </main>
  );
}
