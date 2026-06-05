export type DocsLink = {
  label: string;
  href: string;
  description?: string;
};

export type DocsBlock =
  | {
      kind: "paragraph";
      text: string;
    }
  | {
      kind: "list";
      items: string[];
    }
  | {
      kind: "ordered";
      items: string[];
    }
  | {
      kind: "code";
      language: string;
      code: string;
    }
  | {
      kind: "table";
      columns: string[];
      rows: string[][];
    }
  | {
      kind: "note";
      title: string;
      body: string[];
    }
  | {
      kind: "links";
      links: DocsLink[];
    };

export type DocsSection = {
  id: string;
  title: string;
  blocks: DocsBlock[];
};

export type DocsPage = {
  slug: string;
  title: string;
  shortTitle: string;
  summary: string;
  sections: DocsSection[];
};
