import { DOCS_PAGES, docsHtmlPath } from "../docs/registry";

const DOCS_DESCRIPTION =
  "Official agent-paste usage docs covering install, auth, publish, Artifacts, Access Links, billing, REST, MCP, limits, and safety.";

export function DocsIndexPage() {
  return (
    <main className="content docs-layout">
      <section className="docs-hero">
        <p className="eyebrow mono">Docs</p>
        <h1 className="legal-title">Use agent-paste</h1>
        <p className="legal-lead">{DOCS_DESCRIPTION}</p>
        <div className="docs-actions">
          <a className="button button-primary button-lg" href="/docs.md">
            Markdown index
          </a>
          <a className="button button-ghost button-lg" href="/llms-full.txt">
            llms-full.txt
          </a>
        </div>
      </section>
      <section className="docs-grid" aria-label="Documentation pages">
        {DOCS_PAGES.map((page) => (
          <a className="docs-card" href={docsHtmlPath(page)} key={page.slug}>
            <span className="docs-card-title">{page.title}</span>
            <span className="docs-card-body">{page.summary}</span>
          </a>
        ))}
      </section>
    </main>
  );
}
