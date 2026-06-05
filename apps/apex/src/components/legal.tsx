import type { FC } from "hono/jsx";
import type { LegalBlock, LegalDocument, LegalSection } from "../legal-types.js";
import { Prose, renderDocument, Shell } from "./chrome.js";

const Block: FC<{ block: LegalBlock }> = ({ block }) => {
  if (block.kind === "paragraph") {
    return (
      <p>
        <Prose text={block.text} />
      </p>
    );
  }
  return (
    <ul class="legal-list">
      {block.items.map((item) => (
        <li>
          <Prose text={item} />
        </li>
      ))}
    </ul>
  );
};

const Section: FC<{ section: LegalSection }> = ({ section }) => (
  <article class="legal-section" id={section.id}>
    <h2 class="feature-title">{section.title}</h2>
    <div class="legal-body">
      {section.blocks.map((block) => (
        <Block block={block} />
      ))}
    </div>
  </article>
);

const LegalPage: FC<{ document: LegalDocument }> = ({ document }) => (
  <Shell
    meta={{
      title: `${document.title} | agent-paste.sh`,
      description: document.description,
      canonicalPath: document.path,
    }}
  >
    <main class="content legal-page">
      <section class="legal-hero">
        <p class="eyebrow mono">{document.eyebrow}</p>
        <h1 class="legal-title">{document.title}</h1>
        <p class="legal-updated mono">Effective {document.effectiveDate}</p>
        <p class="legal-lead">{document.lead}</p>
      </section>

      <section class="legal-sections" aria-label={`${document.title} sections`}>
        {document.sections.map((section) => (
          <Section section={section} />
        ))}
      </section>
    </main>
  </Shell>
);

export function renderLegalPage(document: LegalDocument): string {
  return renderDocument(<LegalPage document={document} />);
}
