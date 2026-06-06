import type { FC } from "hono/jsx";
import { ABOUT, ABOUT_SECTIONS, type AboutSection } from "../about.js";
import { ABOUT_META } from "../meta.js";
import { Prose, renderDocument, Shell } from "./chrome.js";

const AboutBlock: FC<{ section: AboutSection }> = ({ section }) => (
  <article class="prose-block">
    <h2 class="prose-title">{section.title}</h2>
    {section.body.map((paragraph) => (
      <p class="prose-body">
        <Prose text={paragraph} />
      </p>
    ))}
  </article>
);

const AboutPage: FC<{ nonce: string; analyticsToken?: string | undefined; billingEnabled: boolean }> = ({
  nonce,
  analyticsToken,
  billingEnabled,
}) => (
  <Shell meta={ABOUT_META} nonce={nonce} analyticsToken={analyticsToken} billingEnabled={billingEnabled}>
    <main class="content">
      <section class="hero">
        <div class="hero-text">
          <p class="eyebrow mono">{ABOUT.eyebrow}</p>
          <h1 class="hero-headline">
            {ABOUT.headline}
            <span class="hero-stop">.</span>
          </h1>
          <p class="hero-lead">{ABOUT.lead}</p>
        </div>
      </section>

      <section class="prose" aria-label="About agent-paste">
        {ABOUT_SECTIONS.map((section) => (
          <AboutBlock section={section} />
        ))}
      </section>
    </main>
  </Shell>
);

export function renderAboutPage(nonce: string, analyticsToken?: string, billingEnabled = false): string {
  return renderDocument(<AboutPage nonce={nonce} analyticsToken={analyticsToken} billingEnabled={billingEnabled} />);
}
