import { Prose } from "@agent-paste/ui";
import {
  INLINE_LINK_CLASS,
  PageHeader,
  RailLink,
  SectionHeading,
  TABLE_CLASS,
  TABLE_WRAP_CLASS,
  TD_CLASS,
  TH_CLASS,
} from "../components/marketing";
import { docsMarkdownPath } from "../docs/registry";
import type { DocsBlock, DocsPage } from "../docs/types";

// Body-copy block spacing shared by paragraph/list/note/link-list (was the
// `.docs-paragraph, .docs-list, .docs-note, .docs-link-list` group).
const BLOCK_TEXT_CLASS = "mt-4 text-h3 leading-loose text-muted";
const LIST_CLASS = `${BLOCK_TEXT_CLASS} list-disc pl-[1.1rem] [&>li]:mt-2 marker:text-accent`;

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
        <p className={BLOCK_TEXT_CLASS}>
          <Prose text={block.text} linkClassName={INLINE_LINK_CLASS} />
        </p>
      );
    case "list":
      return (
        <ul className={LIST_CLASS}>
          {block.items.map((item) => (
            <li key={item}>
              <Prose text={item} linkClassName={INLINE_LINK_CLASS} />
            </li>
          ))}
        </ul>
      );
    case "ordered":
      return (
        <ol className={`${LIST_CLASS} list-decimal`}>
          {block.items.map((item) => (
            <li key={item}>
              <Prose text={item} linkClassName={INLINE_LINK_CLASS} />
            </li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre className="mt-4 overflow-x-auto whitespace-pre rounded-sm border border-rule-strong bg-surface px-4 py-4 font-mono text-sm leading-relaxed text-foreground">
          <code>{block.code}</code>
        </pre>
      );
    case "table":
      return (
        <div className={TABLE_WRAP_CLASS}>
          <table className={TABLE_CLASS}>
            <thead>
              <tr>
                {block.columns.map((column) => (
                  <th className={TH_CLASS} key={column}>
                    <Prose text={column} linkClassName={INLINE_LINK_CLASS} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join("|")} className="[&:last-child>td]:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td className={TD_CLASS} key={block.columns[cellIndex]}>
                      <Prose text={cell} linkClassName={INLINE_LINK_CLASS} />
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
        <aside
          className={`${BLOCK_TEXT_CLASS} grid gap-2 rounded-sm border-l-2 border-accent bg-accent-tint px-4 py-4`}
        >
          <p className="font-semibold text-foreground">{block.title}</p>
          {block.body.map((paragraph) => (
            <p key={paragraph}>
              <Prose text={paragraph} linkClassName={INLINE_LINK_CLASS} />
            </p>
          ))}
        </aside>
      );
    case "links":
      return (
        <ul className={LIST_CLASS}>
          {block.links.map((link) => (
            <li key={link.href}>
              <a className={INLINE_LINK_CLASS} href={link.href}>
                {link.label}
              </a>
              {link.description ? <span className="block text-muted">{link.description}</span> : null}
            </li>
          ))}
        </ul>
      );
  }
}

export function DocsPageView({ page }: { page: DocsPage }) {
  return (
    <main id="main-content" tabIndex={-1}>
      <div className="flex flex-col gap-[clamp(40px,6vh,56px)]">
        <PageHeader
          eyebrow={
            <a
              className="group inline-flex w-fit items-center gap-2 font-mono text-mono-sm font-medium uppercase leading-none tracking-eyebrow text-subtle no-underline transition-colors hover:text-foreground"
              href="/docs"
            >
              <span
                className="inline-block text-accent transition-transform group-hover:-translate-x-[2px]"
                aria-hidden="true"
              >
                ←
              </span>
              Docs
            </a>
          }
          title={page.title}
          summary={page.summary}
          actions={
            <>
              <RailLink href="/docs">Docs index</RailLink>
              <RailLink href={docsMarkdownPath(page)}>Markdown</RailLink>
              <RailLink href="/llms-full.txt">Full text</RailLink>
            </>
          }
        />
        <article className="flex max-w-[76ch] flex-col [&_.code]:bg-accent-tint [&_.code]:text-accent">
          {page.sections.map((section) => (
            <section
              className="scroll-mt-[calc(var(--head-h,64px)+24px)] border-t border-rule py-[clamp(28px,4vh,40px)] first:border-t-0 first:pt-0"
              id={section.id}
              key={section.id}
            >
              <SectionHeading bar>{section.title}</SectionHeading>
              {section.blocks.map((block) => (
                <DocsBlockView block={block} key={docsBlockKey(block)} />
              ))}
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
