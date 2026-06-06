import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { DOCS_PAGES, docsHtmlPath, docsMarkdownPath } from "../docs/registry.js";
import type { DocsBlock, DocsPage } from "../docs/types.js";
import { type PageMeta, renderDocument, Shell } from "./chrome.js";

const DOCS_DESCRIPTION =
  "Official agent-paste usage docs covering install, auth, publish, Artifacts, Access Links, billing, REST, MCP, limits, and safety.";

const DOCS_INDEX_META: PageMeta = {
  title: "agent-paste docs",
  description: DOCS_DESCRIPTION,
  canonicalPath: "/docs",
};

function docsPageMeta(page: DocsPage): PageMeta {
  return {
    title: `${page.title} - agent-paste docs`,
    description: page.summary,
    canonicalPath: docsHtmlPath(page),
  };
}

const DocsIndexPage: FC<{ nonce: string; analyticsToken?: string | undefined; billingEnabled: boolean }> = ({
  nonce,
  analyticsToken,
  billingEnabled,
}) => (
  <Shell meta={DOCS_INDEX_META} nonce={nonce} analyticsToken={analyticsToken} billingEnabled={billingEnabled}>
    <main class="content docs-layout">
      <section class="docs-hero">
        <p class="eyebrow mono">Docs</p>
        <h1 class="legal-title">Use agent-paste</h1>
        <p class="legal-lead">{DOCS_DESCRIPTION}</p>
        <div class="docs-actions">
          <a class="button button-primary button-lg" href="/docs.md">
            Markdown index
          </a>
          <a class="button button-ghost button-lg" href="/llms-full.txt">
            llms-full.txt
          </a>
        </div>
      </section>
      <section class="docs-grid" aria-label="Documentation pages">
        {DOCS_PAGES.map((page) => (
          <a class="docs-card" href={docsHtmlPath(page)}>
            <span class="docs-card-title">{page.title}</span>
            <span class="docs-card-body">{page.summary}</span>
          </a>
        ))}
      </section>
    </main>
  </Shell>
);

const DocsPageView: FC<{
  page: DocsPage;
  nonce: string;
  analyticsToken?: string | undefined;
  billingEnabled: boolean;
}> = ({ page, nonce, analyticsToken, billingEnabled }) => (
  <Shell meta={docsPageMeta(page)} nonce={nonce} analyticsToken={analyticsToken} billingEnabled={billingEnabled}>
    <main class="content docs-layout">
      <section class="docs-hero">
        <a class="eyebrow eyebrow-link mono" href="/docs">
          <span class="eyebrow-back" aria-hidden="true">
            ←
          </span>
          Docs
        </a>
        <h1 class="legal-title">{page.title}</h1>
        <p class="legal-lead">{page.summary}</p>
        <div class="docs-meta-links">
          <a href="/docs">Docs index</a>
          <a href={docsMarkdownPath(page)}>Markdown</a>
          <a href="/llms-full.txt">Full text</a>
        </div>
      </section>
      <article class="docs-body">
        {page.sections.map((section) => (
          <section class="docs-section" id={section.id}>
            <h2 class="docs-section-title">{section.title}</h2>
            {section.blocks.map((block) => (
              <DocsBlockView block={block} />
            ))}
          </section>
        ))}
      </article>
    </main>
  </Shell>
);

const DocsBlockView: FC<{ block: DocsBlock }> = ({ block }) => {
  switch (block.kind) {
    case "paragraph":
      return <p class="docs-paragraph">{Inline(block.text)}</p>;
    case "list":
      return (
        <ul class="docs-list">
          {block.items.map((item) => (
            <li>{Inline(item)}</li>
          ))}
        </ul>
      );
    case "ordered":
      return (
        <ol class="docs-list docs-ordered">
          {block.items.map((item) => (
            <li>{Inline(item)}</li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre class="docs-code mono">
          <code>{block.code}</code>
        </pre>
      );
    case "table":
      return (
        <div class="docs-table-wrap">
          <table class="docs-table">
            <thead>
              <tr>
                {block.columns.map((column) => (
                  <th>{Inline(column)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr>
                  {row.map((cell) => (
                    <td>{Inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "note":
      return (
        <aside class="docs-note">
          <p class="docs-note-title">{block.title}</p>
          {block.body.map((paragraph) => (
            <p>{Inline(paragraph)}</p>
          ))}
        </aside>
      );
    case "links":
      return (
        <ul class="docs-link-list">
          {block.links.map((link) => (
            <li>
              <a href={link.href}>{link.label}</a>
              {link.description ? <span>{link.description}</span> : null}
            </li>
          ))}
        </ul>
      );
  }
};

export function renderDocsIndexPage(nonce: string, analyticsToken?: string, billingEnabled = false): string {
  return renderDocument(
    <DocsIndexPage nonce={nonce} analyticsToken={analyticsToken} billingEnabled={billingEnabled} />,
  );
}

export function renderDocsPage(page: DocsPage, nonce: string, analyticsToken?: string, billingEnabled = false): string {
  return renderDocument(
    <DocsPageView page={page} nonce={nonce} analyticsToken={analyticsToken} billingEnabled={billingEnabled} />,
  );
}

function Inline(text: string): ReturnType<FC> {
  const linked = escapeHtml(text).replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label: string, href: string) => `<a class="docs-inline-link" href="${escapeHtml(href)}">${label}</a>`,
  );
  const coded = linked.replace(/`([^`]+)`/g, '<code class="code">$1</code>');
  return raw(coded);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
