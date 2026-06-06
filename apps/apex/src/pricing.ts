import type { PageMeta } from "./components/chrome.js";

export const PRICING_TITLE = "Pricing - agent-paste.sh";
export const PRICING_DESCRIPTION =
  "Compare Free and Pro plans for the hosted agent-paste service. Reads stay free; Pro raises write allowance, retention, caps, and Live Updates.";

export const PRICING_META: PageMeta = {
  title: PRICING_TITLE,
  description: PRICING_DESCRIPTION,
  canonicalPath: "/pricing",
};

export const PRICING = {
  eyebrow: "Pricing",
  headline: "Free to try, Pro when you need more",
  lead: "Reads are always free. Plans change write allowance, retention windows, size caps, and whether Live Updates are available on your Workspace.",
} as const;
