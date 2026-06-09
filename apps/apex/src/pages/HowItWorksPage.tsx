import { Prose } from "@agent-paste/ui";
import { Eyebrow, PageHeader, ProseBlock, SectionHeading } from "../components/marketing";
import { SourceRepository } from "../components/SourceRepository";
import { HOW_IT_WORKS, HOW_IT_WORKS_SECTIONS, type HowItWorksSection } from "../how-it-works";

function HowItWorksBlock({ section }: { section: HowItWorksSection }) {
  return (
    <ProseBlock>
      <SectionHeading>{section.title}</SectionHeading>
      {section.body.map((paragraph) => (
        <p className="mt-4 text-h3 leading-loose text-muted" key={paragraph}>
          <Prose text={paragraph} />
        </p>
      ))}
    </ProseBlock>
  );
}

export function HowItWorksPage() {
  return (
    <main>
      <div className="flex flex-col gap-[clamp(40px,6vh,64px)]">
        <PageHeader
          eyebrow={<Eyebrow dot={false}>{HOW_IT_WORKS.eyebrow}</Eyebrow>}
          title={
            <>
              {HOW_IT_WORKS.headline}
              <span className="text-accent">.</span>
            </>
          }
          summary={HOW_IT_WORKS.lead}
        />

        <section className="flex max-w-[70ch] flex-col" aria-label="How agent-paste works">
          {HOW_IT_WORKS_SECTIONS.map((section) => (
            <HowItWorksBlock section={section} key={section.title} />
          ))}
          <SourceRepository />
        </section>
      </div>
    </main>
  );
}
