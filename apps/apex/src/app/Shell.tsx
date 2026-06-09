import type { ReactNode } from "react";
import type { PageMeta } from "../meta";
import { Footer, Header } from "./chrome";
import { THEME_INIT_JS } from "./scripts";

export type ApexAssets = { cssHref: string; jsHref: string };

type ShellProps = {
  meta: PageMeta;
  assets: ApexAssets;
  analyticsToken?: string | undefined;
  billingEnabled: boolean;
  /**
   * Full-bleed content mode for the marketing home page: its sections set their
   * own width. Every page shares the sticky marketing Header and Footer; on
   * non-bleed pages (docs/about/legal) the content is wrapped in a constrained
   * `.page-body` container so prose stays at a readable measure.
   */
  bleed?: boolean | undefined;
  children: ReactNode;
};

export function Shell({ meta, assets, analyticsToken, billingEnabled, bleed, children }: ShellProps) {
  const canonical = `https://agent-paste.sh${meta.canonicalPath}`;
  const beaconToken = analyticsToken?.trim();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: THEME_INIT_JS is a fixed build-time constant (no user input) whose sha256 is pinned in the CSP; it must run inline pre-paint to avoid a theme flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_JS }} />
        <title>{meta.title}</title>
        <meta name="description" content={meta.description} />
        <meta name="color-scheme" content="light dark" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="preload" as="font" type="font/woff2" crossOrigin="" href="/fonts/CabinetGrotesk-Variable.woff2" />
        <link rel="preload" as="font" type="font/woff2" crossOrigin="" href="/fonts/Switzer-Variable.woff2" />
        <link rel="preload" as="font" type="font/woff2" crossOrigin="" href="/fonts/SplineSansMono-Variable.woff2" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.description} />
        <meta property="og:url" content={canonical} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={meta.title} />
        <meta name="twitter:description" content={meta.description} />
        <link rel="canonical" href={canonical} />
        <link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt" />
        <link rel="alternate" type="text/plain" href="/llms-full.txt" title="llms-full.txt" />
        <link rel="alternate" type="text/markdown" href="/agents.md" title="agents.md" />
        <link rel="alternate" type="text/markdown" href="/docs.md" title="docs.md" />
        <link rel="stylesheet" href={assets.cssHref} />
        {beaconToken ? (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: beaconToken })}
          />
        ) : null}
      </head>
      <body className="home relative flex min-h-[100svh] flex-col [--head-h:60px] min-[880px]:[--head-h:64px]">
        <Header billingEnabled={billingEnabled} />
        {bleed ? (
          children
        ) : (
          <div className="mx-auto w-full max-w-[920px] flex-[1_0_auto] px-6 pt-12 pb-16 min-[640px]:px-10 min-[640px]:pt-16 min-[640px]:pb-24">
            {children}
          </div>
        )}
        <Footer billingEnabled={billingEnabled} />
        <script type="module" src={assets.jsHref} />
      </body>
    </html>
  );
}
