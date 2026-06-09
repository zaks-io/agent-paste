/**
 * @agent-paste/ui: the shared design-system surface consumed by both the web
 * dashboard (apps/web) and the apex marketing site (apps/apex).
 *
 * The stylesheet is exported as `@agent-paste/ui/styles.css` (generated from the
 * @agent-paste/brand tokens). The React primitives below are the single copy
 * both apps render, so there is no per-app duplicate and the two surfaces cannot
 * drift.
 */

// Cross-surface theme persistence (shared cookie on .agent-paste.sh). Re-exported
// from brand so apps depend only on @agent-paste/ui for the design system.
export {
  buildThemeCookie,
  readThemeCookie,
  THEME_COOKIE,
  type ThemePreference,
  themeCookieDomain,
} from "@agent-paste/brand";
export { Badge, type BadgeTone } from "./components/Badge";
export { Button } from "./components/Button";
export { ButtonAnchor } from "./components/ButtonAnchor";
export { type ButtonSize, type ButtonVariant, buttonClasses } from "./components/buttonClasses";
export { Card, CardHeader, SectionLabel } from "./components/Card";
export { Prose, parseProse } from "./components/Prose";
export { Table, TBody, TD, TH, THead, TR } from "./components/Table";
export { Wordmark } from "./components/Wordmark";
export { cn } from "./lib/cn";
