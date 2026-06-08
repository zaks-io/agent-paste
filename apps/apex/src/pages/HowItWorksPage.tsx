import { Prose } from "@agent-paste/ui";
import { SourceRepository } from "../components/SourceRepository";
import { HOW_IT_WORKS, HOW_IT_WORKS_SECTIONS, type HowItWorksSection } from "../how-it-works";

function HowItWorksBlock({ section }: { section: HowItWorksSection }) {
  return (
    <article className="border-t border-[hsl(var(--rule))] py-[clamp(28px,4vh,40px)] first:border-t-0 first:pt-0">
      <h2 className="m-0 font-display text-[clamp(20px,2.2vw,26px)] font-bold leading-[1.2] tracking-[-0.02em] text-[hsl(var(--foreground))]">
        {section.title}
      </h2>
      {section.body.map((paragraph) => (
        <p className="mt-[14px] text-[15.5px] leading-[1.65] text-[hsl(var(--muted))]" key={paragraph}>
          <Prose text={paragraph} />
        </p>
      ))}
    </article>
  );
}

export function HowItWorksPage() {
  return (
    <main>
      <div className="flex flex-col gap-[clamp(40px,6vh,64px)]">
        <section className="flex flex-col items-start gap-[18px] border-b border-[hsl(var(--rule))] pb-[clamp(32px,5vh,48px)]">
          <div className="flex w-full flex-col items-start gap-[18px]">
            <p className="m-0 inline-flex items-center gap-[9px] font-mono text-[11.5px] font-medium uppercase leading-none tracking-[0.16em] text-[hsl(var(--subtle))]">
              {HOW_IT_WORKS.eyebrow}
            </p>
            <h1 className="m-0 max-w-[18ch] font-display text-[clamp(34px,5.2vw,54px)] font-extrabold leading-[1.04] tracking-[-0.03em] text-balance text-[hsl(var(--foreground))] [font-feature-settings:'ss01']">
              {HOW_IT_WORKS.headline}
              <span className="text-[hsl(var(--accent))]">.</span>
            </h1>
            <p className="m-0 max-w-[60ch] text-[clamp(16px,1.4vw,18px)] leading-[1.6] text-[hsl(var(--muted))]">
              {HOW_IT_WORKS.lead}
            </p>
          </div>
        </section>

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
