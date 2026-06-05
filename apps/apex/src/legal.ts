import { PRIVACY } from "./legal-privacy.js";
import { TERMS } from "./legal-terms.js";

export type { LegalBlock, LegalDocument, LegalSection } from "./legal-types.js";

import type { LegalDocument } from "./legal-types.js";

export function legalDocumentForPath(pathname: string): LegalDocument | null {
  if (pathname === TERMS.path) {
    return TERMS;
  }
  if (pathname === PRIVACY.path) {
    return PRIVACY;
  }
  return null;
}

export { renderLegalPage } from "./components/legal.js";
