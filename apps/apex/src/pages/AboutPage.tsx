import { Prose } from "@agent-paste/ui";
import { ABOUT, ABOUT_SECTIONS, type AboutSection } from "../about";
import { Eyebrow, PageHeader, ProseBlock, SectionHeading } from "../components/marketing";
import { SourceRepository } from "../components/SourceRepository";

function AboutBlock({ section }: { section: AboutSection }) {
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

export function AboutPage() {
  return (
    <main id="main-content" tabIndex={-1}>
      <div className="flex flex-col gap-[clamp(40px,6vh,64px)]">
        <PageHeader
          eyebrow={<Eyebrow dot={false}>{ABOUT.eyebrow}</Eyebrow>}
          title={
            <>
              {ABOUT.headline}
              <span className="text-accent">.</span>
            </>
          }
          summary={ABOUT.lead}
        />

        <section className="flex max-w-[70ch] flex-col" aria-label="About agent-paste">
          {ABOUT_SECTIONS.map((section) => (
            <AboutBlock section={section} key={section.title} />
          ))}
          <SourceRepository />
        </section>
      </div>
    </main>
  );
}
