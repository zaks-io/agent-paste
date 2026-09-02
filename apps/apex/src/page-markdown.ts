// Markdown twins of the prerendered marketing and legal pages. Both renderings
// read the same copy modules the React pages do, so the agent-facing text is the
// page content, not a scrape of its layout.
import { PLANS } from "@agent-paste/plans";
import { ABOUT, ABOUT_SECTIONS } from "./about";
import {
  FEATURES,
  footerColumns,
  HERO,
  INSTALL_PS1_CMD,
  INSTALL_SH_CMD,
  LOGIN_CMD,
  MCP_BASE_URL,
  META_DESCRIPTION,
  PUBLISH_CMD,
  PUBLISH_EPHEMERAL_CMD,
  SKILL_INSTALL_CMD,
  TITLE,
  USE_CASES,
} from "./copy";
import { markdownTable } from "./docs/markdown";
import { HOW_IT_WORKS, HOW_IT_WORKS_SECTIONS } from "./how-it-works";
import type { LegalDocument } from "./legal-types";
import { markdownLink } from "./markdown-twins";
import { pricingComparisonRows } from "./plan-tiers";
import { PRICING } from "./pricing";

type ProseSection = { title: string; body: string[] };

export function renderHomeMarkdown(billingEnabled: boolean): string {
  return lines([
    `# ${TITLE}`,
    "",
    `> ${META_DESCRIPTION}`,
    "",
    HERO.lead,
    "",
    HERO.status,
    "",
    "## When you'd reach for it",
    "",
    ...numbered(USE_CASES.map((useCase) => ({ title: useCase.scenario, body: useCase.outcome }))),
    "",
    "## Publish from a shell",
    "",
    "With no account, publish a static page and get a link back in seconds:",
    "",
    ...fence("sh", PUBLISH_EPHEMERAL_CMD),
    "Log in free once over browser OAuth to keep the work, run JavaScript, and own it:",
    "",
    ...fence("sh", `${LOGIN_CMD}\n${PUBLISH_CMD}`),
    "Install the CLI on macOS or Linux:",
    "",
    ...fence("sh", INSTALL_SH_CMD),
    "Install the CLI on Windows:",
    "",
    ...fence("powershell", INSTALL_PS1_CMD),
    "Install the agent skill for Claude Code and Codex:",
    "",
    ...fence("sh", SKILL_INSTALL_CMD),
    "## Publish from a chat with no shell",
    "",
    `Add \`${MCP_BASE_URL}\` as a remote MCP server, sign in free, and the agent publishes, reads, and shares from there. Setup lives in [MCP server](/docs/mcp.md).`,
    "",
    "## Why the link holds up",
    "",
    ...numbered(FEATURES),
    "",
    "## Links",
    "",
    ...footerLinks(billingEnabled),
  ]);
}

export function renderAboutMarkdown(): string {
  return lines([`# ${ABOUT.headline}`, "", ABOUT.lead, "", ...proseSections(ABOUT_SECTIONS)]);
}

export function renderHowItWorksMarkdown(): string {
  return lines([`# ${HOW_IT_WORKS.headline}`, "", HOW_IT_WORKS.lead, "", ...proseSections(HOW_IT_WORKS_SECTIONS)]);
}

export function renderPricingMarkdown(): string {
  const rows = pricingComparisonRows();
  return lines([
    `# ${PRICING.headline}`,
    "",
    PRICING.lead,
    "",
    ...Object.values(PLANS).flatMap((plan) => [
      `## ${plan.name}`,
      "",
      ...(plan.price ? [`${plan.price.month.amount} ${plan.price.month.per}`, ""] : []),
      ...plan.features.map((feature) => `- ${feature}`),
      "",
    ]),
    "## Compare plans",
    "",
    ...markdownTable(
      ["Feature", PLANS.free.name, PLANS.pro.name],
      rows.map((row) => [row.feature, row.free, row.pro]),
    ),
    "Every plan shares the per-Revision file count, lifetime Revision, and rate limits described in [Billing and Plans](/docs/billing.md), which also covers checkout and subscription management.",
    "",
  ]);
}

export function renderLegalMarkdown(legal: LegalDocument): string {
  return lines([
    `# ${legal.title}`,
    "",
    `Effective ${legal.effectiveDate}`,
    "",
    legal.lead,
    "",
    ...legal.sections.flatMap((section) => [
      `## ${section.title}`,
      "",
      ...section.blocks.flatMap((block) =>
        block.kind === "paragraph" ? [block.text, ""] : [...block.items.map((item) => `- ${item}`), ""],
      ),
    ]),
  ]);
}

function proseSections(sections: readonly ProseSection[]): string[] {
  return sections.flatMap((section) => [`## ${section.title}`, "", ...section.body.flatMap((text) => [text, ""])]);
}

// The footer is the page's own link map, so the Markdown twin reuses it and
// points each on-site link at that page's Markdown twin.
function footerLinks(billingEnabled: boolean): string[] {
  return footerColumns(billingEnabled).flatMap((column) => [
    `### ${column.heading}`,
    "",
    ...column.links.map((link) => `- [${link.label}](${markdownLink(link.href)})`),
    "",
  ]);
}

// A numbered item keeps its heading on its own line so the raw Markdown reads as
// "label, then detail" rather than one run-on sentence.
function numbered(items: readonly { title: string; body: string }[]): string[] {
  return items.map((item, index) => `${index + 1}. **${item.title}**\n   ${item.body}`);
}

function fence(language: string, code: string): string[] {
  return [`\`\`\`${language}`, code, "```", ""];
}

function lines(parts: string[]): string {
  return `${parts.join("\n").trimEnd()}\n`;
}
