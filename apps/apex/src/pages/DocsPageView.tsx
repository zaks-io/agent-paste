import { Prose } from "@agent-paste/ui";
import { docsMarkdownPath } from "../docs/registry";
import type { DocsBlock, DocsPage } from "../docs/types";

// Stable React key per block from its content (blocks have no id). Static SSG,
// but the repo avoids array-index keys; content is unique within a section.
function docsBlockKey(block: DocsBlock): string {
  switch (block.kind) {
    case "paragraph":
      return block.text;
    case "list":
    case "ordered":
      return block.items.join("|");
    case "code":
      return block.code;
    case "table":
      return block.columns.join("|");
    case "note":
      return block.title;
    case "links":
      return block.links.map((link) => link.href).join("|");
  }
}

function DocsBlockView({ block }: { block: DocsBlock }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p className="docs-paragraph">
          <Prose text={block.text} linkClassName="docs-inline-link" />
        </p>
      );
    case "list":
      return (
        <ul className="docs-list">
          {block.items.map((item) => (
            <li key={item}>
              <Prose text={item} linkClassName="docs-inline-link" />
            </li>
          ))}
        </ul>
      );
    case "ordered":
      return (
        <ol className="docs-list docs-ordered">
          {block.items.map((item) => (
            <li key={item}>
              <Prose text={item} linkClassName="docs-inline-link" />
            </li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre className="docs-code mono">
          <code>{block.code}</code>
        </pre>
      );
    case "table":
      return (
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                {block.columns.map((column) => (
                  <th key={column}>
                    <Prose text={column} linkClassName="docs-inline-link" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell, cellIndex) => (
                    <td key={block.columns[cellIndex]}>
                      <Prose text={cell} linkClassName="docs-inline-link" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "note":
      return (
        <aside className="docs-note">
          <p className="docs-note-title">{block.title}</p>
          {block.body.map((paragraph) => (
            <p key={paragraph}>
              <Prose text={paragraph} linkClassName="docs-inline-link" />
            </p>
          ))}
        </aside>
      );
    case "links":
      return (
        <ul className="docs-link-list">
          {block.links.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
              {link.description ? <span>{link.description}</span> : null}
            </li>
          ))}
        </ul>
      );
  }
}

export function DocsPageView({ page }: { page: DocsPage }) {
  return (
    <main className="content docs-layout">
      <section className="docs-hero">
        <a className="eyebrow eyebrow-link mono" href="/docs">
          <span className="eyebrow-back" aria-hidden="true">
            ←
          </span>
          Docs
        </a>
        <h1 className="legal-title">{page.title}</h1>
        <p className="legal-lead">{page.summary}</p>
        <div className="docs-meta-links">
          <a href="/docs">Docs index</a>
          <a href={docsMarkdownPath(page)}>Markdown</a>
          <a href="/llms-full.txt">Full text</a>
        </div>
      </section>
      <article className="docs-body">
        {page.sections.map((section) => (
          <section className="docs-section" id={section.id} key={section.id}>
            <h2 className="docs-section-title">{section.title}</h2>
            {section.blocks.map((block) => (
              <DocsBlockView block={block} key={docsBlockKey(block)} />
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
