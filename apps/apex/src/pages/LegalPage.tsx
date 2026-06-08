import { Prose } from "@agent-paste/ui";
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
    <ul className="legal-list">
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
    <article className="legal-section" id={section.id}>
      <h2 className="feature-title">{section.title}</h2>
      <div className="legal-body">
        {section.blocks.map((block) => (
          <LegalBlockView block={block} key={legalBlockKey(block)} />
        ))}
      </div>
    </article>
  );
}

export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <main className="content legal-page">
      <section className="legal-hero">
        <p className="eyebrow mono">{document.eyebrow}</p>
        <h1 className="legal-title">{document.title}</h1>
        <p className="legal-updated mono">Effective {document.effectiveDate}</p>
        <p className="legal-lead">{document.lead}</p>
      </section>

      <section className="legal-sections" aria-label={`${document.title} sections`}>
        {document.sections.map((section) => (
          <LegalSectionView section={section} key={section.id} />
        ))}
      </section>
    </main>
  );
}
