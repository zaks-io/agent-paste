import { isBillingEnabled } from "@agent-paste/config";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApexAssets } from "./app/Shell";
import { Shell } from "./app/Shell";
import { getRoutes } from "./routes";

// Build-time switches. The prerender (scripts/prerender.mjs) runs this module in
// Node, so process.env reflects the env the build was invoked with
// (BILLING_ENABLED / CF_WEB_ANALYTICS_TOKEN). The values are baked into the
// emitted HTML; nothing is read at request time.
const BILLING_ENABLED = isBillingEnabled(process.env.BILLING_ENABLED);
const ANALYTICS_TOKEN = process.env.CF_WEB_ANALYTICS_TOKEN;

const ROUTES = getRoutes(BILLING_ENABLED);

export const ROUTE_PATHS: string[] = ROUTES.map((route) => route.path);

export function render(path: string, assets: ApexAssets): string {
  const route = ROUTES.find((candidate) => candidate.path === path);
  if (!route) {
    throw new Error(`No apex route for path: ${path}`);
  }
  const html = renderToStaticMarkup(
    <Shell
      meta={route.meta}
      assets={assets}
      analyticsToken={ANALYTICS_TOKEN}
      billingEnabled={BILLING_ENABLED}
      bleed={route.bleed}
    >
      {route.element}
    </Shell>,
  );
  return `<!doctype html>\n${html}`;
}
