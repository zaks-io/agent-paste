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
    <ul className="m-0 grid list-disc gap-[8px] pl-[1.1rem] marker:text-[hsl(var(--accent))]">
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
    <article
      className="scroll-mt-[calc(var(--head-h,64px)+24px)] border-t border-[hsl(var(--rule))] py-[clamp(28px,4vh,40px)] first:border-t-0 first:pt-0"
      id={section.id}
    >
      <h2 className="m-0 font-display text-[clamp(20px,2.2vw,26px)] font-bold leading-[1.2] tracking-[-0.02em] text-[hsl(var(--foreground))]">
        {section.title}
      </h2>
      <div className="mt-[14px] grid gap-[12px] text-[15.5px] leading-[1.65] text-[hsl(var(--muted))]">
        {section.blocks.map((block) => (
          <LegalBlockView block={block} key={legalBlockKey(block)} />
        ))}
      </div>
    </article>
  );
}

export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <main>
      <div className="flex flex-col gap-[clamp(40px,6vh,64px)]">
        <section className="flex flex-col items-start gap-[18px] border-b border-[hsl(var(--rule))] pb-[clamp(32px,5vh,48px)]">
          <p className="m-0 inline-flex items-center gap-[9px] font-mono text-[11.5px] font-medium uppercase leading-none tracking-[0.16em] text-[hsl(var(--subtle))]">
            {document.eyebrow}
          </p>
          <h1 className="m-0 max-w-[18ch] font-display text-[clamp(34px,5.2vw,54px)] font-extrabold leading-[1.04] tracking-[-0.03em] text-balance text-[hsl(var(--foreground))] [font-feature-settings:'ss01']">
            {document.title}
          </h1>
          <p className="m-0 font-mono text-[12px] tracking-[0.02em] text-[hsl(var(--subtle))]">
            Effective {document.effectiveDate}
          </p>
          <p className="m-0 max-w-[60ch] text-[clamp(16px,1.4vw,18px)] leading-[1.6] text-[hsl(var(--muted))]">
            {document.lead}
          </p>
        </section>

        <section className="flex max-w-[70ch] flex-col" aria-label={`${document.title} sections`}>
          {document.sections.map((section) => (
            <LegalSectionView section={section} key={section.id} />
          ))}
        </section>
      </div>
    </main>
  );
}
