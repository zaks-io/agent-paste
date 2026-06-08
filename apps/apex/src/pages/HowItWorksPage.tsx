import { Prose } from "@agent-paste/ui";
import { SourceRepository } from "../components/SourceRepository";
import { HOW_IT_WORKS, HOW_IT_WORKS_SECTIONS, type HowItWorksSection } from "../how-it-works";

function HowItWorksBlock({ section }: { section: HowItWorksSection }) {
  return (
    <article className="prose-block">
      <h2 className="prose-title">{section.title}</h2>
      {section.body.map((paragraph) => (
        <p className="prose-body" key={paragraph}>
          <Prose text={paragraph} />
        </p>
      ))}
    </article>
  );
}

export function HowItWorksPage() {
  return (
    <main className="content">
      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow mono">{HOW_IT_WORKS.eyebrow}</p>
          <h1 className="hero-headline">
            {HOW_IT_WORKS.headline}
            <span className="hero-stop">.</span>
          </h1>
          <p className="hero-lead">{HOW_IT_WORKS.lead}</p>
        </div>
      </section>

      <section className="prose" aria-label="How agent-paste works">
        {HOW_IT_WORKS_SECTIONS.map((section) => (
          <HowItWorksBlock section={section} key={section.title} />
        ))}
        <SourceRepository />
      </section>
    </main>
  );
}
