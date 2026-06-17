import { docsHtmlPath, docsMarkdownPath } from "./registry";
import type { DocsBlock, DocsPage } from "./types";

export function renderDocsIndexMarkdown(pages: readonly DocsPage[]): string {
  return [
    "# agent-paste docs",
    "",
    "Official public usage docs for humans and agents.",
    "",
    "- Human docs: /docs",
    "- Markdown index: /docs.md",
    "- Full corpus: /llms-full.txt",
    "- Agent guide: /agents.md",
    "- LLM summary: /llms.txt",
    "",
    "## Pages",
    "",
    ...pages.flatMap((page) => [`- [${page.title}](${docsMarkdownPath(page)}) - ${page.summary}`]),
    "",
  ].join("\n");
}

export function renderDocsPageMarkdown(page: DocsPage): string {
  return [
    `# ${page.title}`,
    "",
    page.summary,
    "",
    `Human page: ${docsHtmlPath(page)}`,
    `Markdown page: ${docsMarkdownPath(page)}`,
    "",
    ...page.sections.flatMap((section) => [`## ${section.title}`, "", ...section.blocks.flatMap(markdownForBlock)]),
  ].join("\n");
}

export function renderLlmsFullText(pages: readonly DocsPage[]): string {
  return [
    "# agent-paste full docs",
    "",
    "This is the complete machine-readable public docs corpus for agent-paste.",
    "Human docs start at /docs. Per-page Markdown twins live under /docs/{slug}.md.",
    "",
    renderDocsIndexMarkdown(pages).trim(),
    "",
    ...pages.map((page) => renderDocsPageMarkdown(page).trim()),
    "",
  ].join("\n\n");
}

function markdownForBlock(block: DocsBlock): string[] {
  switch (block.kind) {
    case "paragraph":
      return [block.text, ""];
    case "list":
      return [...block.items.map((item) => `- ${item}`), ""];
    case "ordered":
      return [...block.items.map((item, index) => `${index + 1}. ${item}`), ""];
    case "code":
      return [`\`\`\`${block.language}`, block.code, "```", ""];
    case "table":
      return markdownTable(block.columns, block.rows);
    case "note":
      return [`> ${block.title}`, ...block.body.map((line) => `> ${line}`), ""];
    case "links":
      return [
        ...block.links.map((link) =>
          link.description
            ? `- [${link.label}](${link.href}) - ${link.description}`
            : `- [${link.label}](${link.href})`,
        ),
        "",
      ];
  }
}

function markdownTable(columns: string[], rows: string[][]): string[] {
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    "",
  ];
}
