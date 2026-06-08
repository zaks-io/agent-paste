import type { FC } from "hono/jsx";
import { HOW_IT_WORKS, HOW_IT_WORKS_SECTIONS, type HowItWorksSection } from "../how-it-works.js";
import { HOW_IT_WORKS_META } from "../meta.js";
import { Prose, renderDocument, Shell } from "./chrome.js";
import { SourceRepositoryBlock } from "./source-repository.js";

const HowItWorksBlock: FC<{ section: HowItWorksSection }> = ({ section }) => (
  <article class="prose-block">
    <h2 class="prose-title">{section.title}</h2>
    {section.body.map((paragraph) => (
      <p class="prose-body">
        <Prose text={paragraph} />
      </p>
    ))}
  </article>
);

const HowItWorksPage: FC<{ nonce: string; analyticsToken?: string | undefined; billingEnabled: boolean }> = ({
  nonce,
  analyticsToken,
  billingEnabled,
}) => (
  <Shell meta={HOW_IT_WORKS_META} nonce={nonce} analyticsToken={analyticsToken} billingEnabled={billingEnabled}>
    <main class="content">
      <section class="hero">
        <div class="hero-text">
          <p class="eyebrow mono">{HOW_IT_WORKS.eyebrow}</p>
          <h1 class="hero-headline">
            {HOW_IT_WORKS.headline}
            <span class="hero-stop">.</span>
          </h1>
          <p class="hero-lead">{HOW_IT_WORKS.lead}</p>
        </div>
      </section>

      <section class="prose" aria-label="How agent-paste works">
        {HOW_IT_WORKS_SECTIONS.map((section) => (
          <HowItWorksBlock section={section} />
        ))}
        <SourceRepositoryBlock />
      </section>
    </main>
  </Shell>
);

export function renderHowItWorksPage(nonce: string, analyticsToken?: string, billingEnabled = false): string {
  return renderDocument(
    <HowItWorksPage nonce={nonce} analyticsToken={analyticsToken} billingEnabled={billingEnabled} />,
  );
}
