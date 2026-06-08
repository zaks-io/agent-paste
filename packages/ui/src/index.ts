/**
 * @agent-paste/ui: the shared design-system surface consumed by both the web
 * dashboard (apps/web) and the apex marketing site (apps/apex).
 *
 * The stylesheet is exported as `@agent-paste/ui/styles.css` (generated from the
 * @agent-paste/brand tokens). The React primitives below are the single copy
 * both apps render, so there is no per-app duplicate and the two surfaces cannot
 * drift.
 */

export { Badge, type BadgeTone } from "./components/Badge";
export { Button, type ButtonSize, type ButtonVariant } from "./components/Button";
export { Card, CardHeader, SectionLabel } from "./components/Card";
export { Prose, parseProse } from "./components/Prose";
export { Table, TBody, TD, TH, THead, TR } from "./components/Table";
export { Wordmark } from "./components/Wordmark";
export { cn } from "./lib/cn";
