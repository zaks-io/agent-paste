export type PageMeta = { title: string; description: string; canonicalPath: string };

import { META_DESCRIPTION, TITLE } from "./copy";

export const HOME_META: PageMeta = {
  title: TITLE,
  description: META_DESCRIPTION,
  canonicalPath: "/",
};

export const ABOUT_TITLE = "About agent-paste.sh: where agents publish";
export const ABOUT_DESCRIPTION =
  "Why agent-paste exists, the boundary it keeps, and how the live early-alpha service is built and run.";

export const ABOUT_META: PageMeta = {
  title: ABOUT_TITLE,
  description: ABOUT_DESCRIPTION,
  canonicalPath: "/about",
};

export const HOW_IT_WORKS_TITLE = "How agent-paste works";
export const HOW_IT_WORKS_DESCRIPTION =
  "How agent-paste keeps workspaces separate, stores files privately, isolates generated content, and makes shared handoffs revocable.";

export const HOW_IT_WORKS_META: PageMeta = {
  title: HOW_IT_WORKS_TITLE,
  description: HOW_IT_WORKS_DESCRIPTION,
  canonicalPath: "/how-it-works",
};
