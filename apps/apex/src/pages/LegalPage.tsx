import { Prose } from "@agent-paste/ui";
import { Eyebrow, PageHeader, ProseBlock, SectionHeading } from "../components/marketing";
import type { LegalBlock, LegalDocument, LegalSection } from "../legal-types";

// Stable React key per block from its content (blocks have no id), matching the
// repo's no-array-index-key convention.
function legalBlockKey(block: LegalBlock): string {
  return block.kind === "paragraph" ? block.text : block.items.join("|");
}

function LegalBlockView({ block }: { block: LegalBlock }) {
  if (block.kind === "paragraph") {
    return (
      <p>
        <Prose text={block.text} />
      </p>
    );
  }
  return (
    <ul className="m-0 grid list-disc gap-2 pl-[1.1rem] marker:text-accent">
      {block.items.map((item) => (
        <li key={item}>
          <Prose text={item} />
        </li>
      ))}
    </ul>
  );
}

function LegalSectionView({ section }: { section: LegalSection }) {
  return (
    <ProseBlock id={section.id} scrollAnchor>
      <SectionHeading>{section.title}</SectionHeading>
      <div className="mt-4 grid gap-3 text-h3 leading-loose text-muted">
        {section.blocks.map((block) => (
          <LegalBlockView block={block} key={legalBlockKey(block)} />
        ))}
      </div>
    </ProseBlock>
  );
}

export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <main id="main-content" tabIndex={-1}>
      <div className="flex flex-col gap-[clamp(40px,6vh,64px)]">
        <PageHeader eyebrow={<Eyebrow dot={false}>{document.eyebrow}</Eyebrow>} title={document.title}>
          <p className="m-0 font-mono text-xs tracking-wide text-subtle">Effective {document.effectiveDate}</p>
          <p className="m-0 max-w-[60ch] text-lg leading-relaxed text-muted">{document.lead}</p>
        </PageHeader>

        <section className="flex max-w-[70ch] flex-col" aria-label={`${document.title} sections`}>
          {document.sections.map((section) => (
            <LegalSectionView section={section} key={section.id} />
          ))}
        </section>
      </div>
    </main>
  );
}
