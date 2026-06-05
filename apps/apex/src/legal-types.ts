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
