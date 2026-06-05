import { esc, renderProse, renderShell } from "./chrome.js";
import { PRIVACY } from "./legal-privacy.js";
import { TERMS } from "./legal-terms.js";

export type LegalBlock =
  | {
      kind: "paragraph";
      text: string;
    }
  | {
      kind: "list";
      items: string[];
    };

export type LegalSection = {
  id: string;
  title: string;
  blocks: LegalBlock[];
};

export type LegalDocument = {
  path: "/terms" | "/privacy";
  title: string;
  eyebrow: string;
  description: string;
  lead: string;
  effectiveDate: string;
  sections: LegalSection[];
};

export function legalDocumentForPath(pathname: string): LegalDocument | null {
  if (pathname === TERMS.path) {
    return TERMS;
  }
  if (pathname === PRIVACY.path) {
    return PRIVACY;
  }
  return null;
}

export function renderLegalPage(document: LegalDocument): string {
  return renderShell({
    meta: {
      title: `${document.title} | agent-paste.sh`,
      description: document.description,
      canonicalPath: document.path,
    },
    main: `<main class="content legal-page">
        <section class="legal-hero">
          <p class="eyebrow mono">${esc(document.eyebrow)}</p>
          <h1 class="legal-title">${esc(document.title)}</h1>
          <p class="legal-updated mono">Effective ${esc(document.effectiveDate)}</p>
          <p class="legal-lead">${esc(document.lead)}</p>
        </section>

        <section class="legal-sections" aria-label="${esc(document.title)} sections">
          ${document.sections.map(renderSection).join("\n          ")}
        </section>
      </main>`,
  });
}

function renderSection(section: LegalSection): string {
  return `<article class="legal-section" id="${esc(section.id)}">
            <h2 class="feature-title">${esc(section.title)}</h2>
            <div class="legal-body">
              ${section.blocks.map(renderBlock).join("\n              ")}
            </div>
          </article>`;
}

function renderBlock(block: LegalBlock): string {
  if (block.kind === "paragraph") {
    return `<p>${renderProse(block.text)}</p>`;
  }
  const items = block.items.map((item) => `<li>${renderProse(item)}</li>`).join("");
  return `<ul class="legal-list">${items}</ul>`;
}
