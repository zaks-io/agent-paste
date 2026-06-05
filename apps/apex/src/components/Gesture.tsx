import type { FC } from "hono/jsx";

/**
 * The brand mark's grammar as a reusable inline unit: chevron > line - node.
 * Pure shapes (no image, no gradient). `class` lets callers retune scale per
 * context (e.g. the transcript variant shrinks the line and node via CSS).
 */
export const Gesture: FC<{ class?: string }> = ({ class: cls }) => (
  <span class={cls ? `gesture ${cls}` : "gesture"} aria-hidden="true">
    <span class="g-chevron">&gt;</span>
    <span class="g-line" />
    <span class="g-node" />
  </span>
);
