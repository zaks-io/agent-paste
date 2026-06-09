import { ButtonAnchor } from "@agent-paste/ui";
import { PageHeader } from "../components/marketing";
import { DOCS_PAGES, docsHtmlPath } from "../docs/registry";

const DOCS_DESCRIPTION =
  "Official agent-paste usage docs covering install, auth, publish, Artifacts, Access Links, billing, REST, MCP, limits, and safety.";

export function DocsIndexPage() {
  return (
    <main>
      <div className="flex flex-col gap-[clamp(40px,6vh,56px)]">
        <PageHeader
          eyebrow="Docs"
          title="Use agent-paste"
          summary={DOCS_DESCRIPTION}
          actions={
            <>
              <ButtonAnchor href="/docs.md" size="lg">
                Markdown index
              </ButtonAnchor>
              <ButtonAnchor href="/llms-full.txt" size="lg" variant="secondary">
                llms-full.txt
              </ButtonAnchor>
            </>
          }
        />
        <section
          className="grid grid-cols-1 gap-3 [@media(min-width:720px)]:grid-cols-2"
          aria-label="Documentation pages"
        >
          {DOCS_PAGES.map((page) => (
            <a
              className="group grid min-h-[132px] gap-2 rounded-sm border border-rule bg-surface p-4 transition-[border-color,background-color] duration-[80ms] ease-out hover:border-accent hover:bg-surface-2"
              href={docsHtmlPath(page)}
              key={page.slug}
            >
              <span className="flex items-baseline gap-2 font-display text-h2 font-semibold leading-snug tracking-tight text-foreground transition-colors group-hover:text-accent">
                {page.title}
                <span
                  className="ml-auto text-accent opacity-0 transition-[opacity,transform] -translate-x-1 group-hover:translate-x-0 group-hover:opacity-100"
                  aria-hidden="true"
                >
                  →
                </span>
              </span>
              <span className="text-base leading-relaxed text-muted">{page.summary}</span>
            </a>
          ))}
        </section>
      </div>
    </main>
  );
}
