import { Prose } from "@agent-paste/ui";
import { ABOUT, ABOUT_SECTIONS, type AboutSection } from "../about";
import { SourceRepository } from "../components/SourceRepository";

function AboutBlock({ section }: { section: AboutSection }) {
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

export function AboutPage() {
  return (
    <main className="content">
      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow mono">{ABOUT.eyebrow}</p>
          <h1 className="hero-headline">
            {ABOUT.headline}
            <span className="hero-stop">.</span>
          </h1>
          <p className="hero-lead">{ABOUT.lead}</p>
        </div>
      </section>

      <section className="prose" aria-label="About agent-paste">
        {ABOUT_SECTIONS.map((section) => (
          <AboutBlock section={section} key={section.title} />
        ))}
        <SourceRepository />
      </section>
    </main>
  );
}
