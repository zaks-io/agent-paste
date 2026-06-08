import { Prose } from "@agent-paste/ui";
import { docsMarkdownPath } from "../docs/registry";
import type { DocsBlock, DocsPage } from "../docs/types";

// Inline-link treatment shared across docs prose (was `.docs-inline-link`):
// foreground text, accent-tinted underline. Passed to Prose as linkClassName so
// links the markup author embeds inherit it.
const INLINE_LINK_CLASS =
  "text-[hsl(var(--foreground))] underline decoration-[hsl(var(--accent)/0.4)] decoration-[1px] underline-offset-[3px]";

// Shared table treatment (was `.docs-table*`), reused by the pricing comparison.
const TABLE_WRAP_CLASS = "mt-[14px] overflow-x-auto rounded-[var(--radius-sm)] border border-[hsl(var(--rule))]";
const TABLE_CLASS = "w-full min-w-[560px] border-collapse text-[13.5px] leading-[1.45]";
const TH_CLASS =
  "border-b border-[hsl(var(--rule))] bg-[hsl(var(--surface))] px-[12px] py-[11px] text-left align-top font-semibold text-[hsl(var(--foreground))]";
const TD_CLASS = "border-b border-[hsl(var(--rule))] px-[12px] py-[11px] text-left align-top text-[hsl(var(--muted))]";

// Body-copy block spacing shared by paragraph/list/note/link-list (was the
// `.docs-paragraph, .docs-list, .docs-note, .docs-link-list` group).
const BLOCK_TEXT_CLASS = "mt-[14px] text-[15.5px] leading-[1.65] text-[hsl(var(--muted))]";
const LIST_CLASS = `${BLOCK_TEXT_CLASS} list-disc pl-[1.1rem] [&>li]:mt-[6px] marker:text-[hsl(var(--accent))]`;

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
        <pre className="mt-[14px] overflow-x-auto whitespace-pre rounded-[var(--radius-sm)] border border-[hsl(var(--rule-strong))] bg-[hsl(var(--surface))] px-[16px] py-[14px] font-mono text-[13px] leading-[1.55] text-[hsl(var(--foreground))]">
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
          className={`${BLOCK_TEXT_CLASS} grid gap-[8px] rounded-[var(--radius-sm)] border-l-2 border-[hsl(var(--accent))] bg-[hsl(var(--accent-tint))] px-[16px] py-[14px]`}
        >
          <p className="font-semibold text-[hsl(var(--foreground))]">{block.title}</p>
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
              {link.description ? <span className="block text-[hsl(var(--muted))]">{link.description}</span> : null}
            </li>
          ))}
        </ul>
      );
  }
}

export function DocsPageView({ page }: { page: DocsPage }) {
  return (
    <main>
      <div className="flex flex-col gap-[clamp(40px,6vh,56px)]">
        <section className="flex flex-col items-start gap-[18px] border-b border-[hsl(var(--rule))] pb-[clamp(32px,5vh,48px)]">
          <a
            className="group inline-flex w-fit items-center gap-[9px] font-mono text-[11.5px] font-medium uppercase leading-none tracking-[0.16em] text-[hsl(var(--subtle))] no-underline transition-colors hover:text-[hsl(var(--foreground))]"
            href="/docs"
          >
            <span className="inline-block transition-transform group-hover:-translate-x-[2px]" aria-hidden="true">
              ←
            </span>
            Docs
          </a>
          <h1 className="m-0 max-w-[18ch] font-display text-[clamp(34px,5.2vw,54px)] font-extrabold leading-[1.04] tracking-[-0.03em] text-balance text-[hsl(var(--foreground))] [font-feature-settings:'ss01']">
            {page.title}
          </h1>
          <p className="m-0 max-w-[60ch] text-[clamp(16px,1.4vw,18px)] leading-[1.6] text-[hsl(var(--muted))]">
            {page.summary}
          </p>
          <div className="flex flex-wrap gap-x-[14px] gap-y-[10px]">
            <a
              className="font-mono text-[12.5px] text-[hsl(var(--muted))] underline decoration-[hsl(var(--accent)/0.4)] decoration-[1px] underline-offset-[3px]"
              href="/docs"
            >
              Docs index
            </a>
            <a
              className="font-mono text-[12.5px] text-[hsl(var(--muted))] underline decoration-[hsl(var(--accent)/0.4)] decoration-[1px] underline-offset-[3px]"
              href={docsMarkdownPath(page)}
            >
              Markdown
            </a>
            <a
              className="font-mono text-[12.5px] text-[hsl(var(--muted))] underline decoration-[hsl(var(--accent)/0.4)] decoration-[1px] underline-offset-[3px]"
              href="/llms-full.txt"
            >
              Full text
            </a>
          </div>
        </section>
        <article className="flex max-w-[76ch] flex-col">
          {page.sections.map((section) => (
            <section
              className="scroll-mt-[calc(var(--head-h,64px)+24px)] border-t border-[hsl(var(--rule))] py-[clamp(28px,4vh,40px)] first:border-t-0 first:pt-0"
              id={section.id}
              key={section.id}
            >
              <h2 className="m-0 font-display text-[clamp(20px,2.2vw,26px)] font-bold leading-[1.2] tracking-[-0.02em] text-[hsl(var(--foreground))]">
                {section.title}
              </h2>
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
