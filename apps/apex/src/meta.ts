import type { PageMeta } from "./components/chrome.js";
import { META_DESCRIPTION, TITLE } from "./copy.js";

export const HOME_META: PageMeta = {
  title: TITLE,
  description: META_DESCRIPTION,
  canonicalPath: "/",
};

export const ABOUT_TITLE = "About agent-paste.sh: where agents publish";
export const ABOUT_DESCRIPTION =
  "Why agent-paste exists, the wedge it fills, the boundaries it keeps, and an honest account of how it is built and run. Pre-launch, solo, transient by default.";

export const ABOUT_META: PageMeta = {
  title: ABOUT_TITLE,
  description: ABOUT_DESCRIPTION,
  canonicalPath: "/about",
};
