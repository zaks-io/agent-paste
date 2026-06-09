# Frontend Style Guide

The visual and interaction standard for everything humans see in **agent-paste**: the marketing surface, the workspace dashboard, the public **Artifact** view, and the renderer pages in the content origin. This document is the source of truth. If a component does not exist here, design it to extend this guide; do not invent a parallel system.

The audience is technical and discerning. Developers, agent builders, security-minded operators. They expect the UI to feel like a piece of professional software, not a marketing pitch. They expect interactions to feel correct, not clever. This guide commits to that audience.

---

## 0. Unified surfaces

The marketing worker (`apps/apex`) and the dashboard (`apps/web`) share **one** visual language. They are different code stacks — apex is a server-rendered hono/jsx worker with inlined CSS, web is React + Tailwind v4 — but they pull from a single token source and read as one product.

- **One token source:** `@agent-paste/brand` (`packages/brand/src/tokens.ts`) is the single source of truth for color, type, spacing, radii, and easing. The web app derives `globals.css` from it (guard-tested by `apps/web/test/brand-tokens-parity.test.ts`); apex builds its inline `<style>` from the same package's helpers (`cssVarsBlock`, `fontFaceCss`). Neither surface hardcodes a brand value.
- **One of everything that matters:** one type system, one accent (vermilion), one radius scale (2/3/4px), one wordmark (`agent-paste.sh`), and a dead-flat surface (no grain, no glows).
- **What differs is content layout, not visual language.** The dashboard is data-dense (the overview's big-figure composition, §8.2); marketing is a wide editorial column (§8.1). Same tokens, same chrome, same discipline — different information density.

When you touch one surface, assume the other inherits the same rule. If you need a new token or a new shape, add it to `@agent-paste/brand` so both surfaces get it, never to one app's CSS.

---

## 1. Aesthetic Direction: Flat, square, one voltage

The product is infrastructure — a control room for addressable **Artifacts** and **Revisions**. It should feel like infrastructure done well: precise, dense where it earns it, quiet everywhere else. Four commitments shape every decision below.

**Two first-class themes, dead flat.** Dark is a neutral near-black (`--ink-0`, `240 6% 5%`); light is a warm paper (`--background`, `60 17% 98%`). Both are designed, not afterthoughts — the bare `:root` is dark so first paint is correct without JS, but light is held to the same bar. The surface is flat: no grain, no glow, no gradient. Atmosphere comes from type, whitespace, and the one accent, nothing layered behind them.

**Depth from a surface ladder and 1px hairlines, not shadows.** A near-neutral hue stepped by lightness (`--ink-0…3`, `--line`/`--line-2`) builds every layer. The default separator is a hairline rule; the secondary separator is a tone step. Drop shadows are reserved for overlays that genuinely float (modals, dropdowns, popovers) — never on a card, never as decoration.

**Hierarchy by scale.** One big figure dominates a view (the overview's hero stat, the marketing headline); everything else recedes to a tiny mono rail with tabular figures. We earn interest from the size jump between the one loud element and the quiet data around it — not from color, not from ornament. This is the composition the dashboard overview makes canonical (§8.2).

**One voltage, square corners.** A single vermilion accent (`--vermilion`, `10 100% 54%`) does one job: primary action, focus ring, live-state. Never a gradient wash, never a second accent. Corners are square-ish — radius is the exception (2/3/4px), never the rule. The signature interaction is the identifier: mono, tinted, silently copyable (§5.11). Spend design budget there, not on hero animations.

**What we are not.** Not a glassmorphism dashboard. Not a gradient-mesh hero. Not a neon dark mode. Not editorial / archival / terminal-themed. Not chasing a metaphor. If a design choice would feel out of place at Linear, Stripe, or Vercel's cleaner work, look closer; if it would feel _identical_ to any of them, look closer still.

---

## 2. Typography

### 2.1 Faces

Three faces. No fourth without an ADR.

| Role        | Family                      | Source      | Used For                                                                   |
| ----------- | --------------------------- | ----------- | -------------------------------------------------------------------------- |
| **Display** | Cabinet Grotesk (variable)  | Self-hosted | The hero figure, large headlines, the wordmark                             |
| **UI**      | Switzer (variable)          | Self-hosted | Body, labels, navigation, forms — everything that isn't a headline or mono |
| **Mono**    | Spline Sans Mono (variable) | Self-hosted | Code, **Artifact** IDs, **Revision** IDs, **Access Link** URLs, timestamps |

Cabinet Grotesk is a confident geometric grotesque that holds its character at hero scale, where the landing page earns its voice. Switzer is a clean, neutral workhorse grotesque that stays quiet and legible at body and label sizes, so the display face never has to do double duty. Spline Sans Mono is a calm, technical mono with sane disambiguation (`0`, `O`, `l`, `1`) that holds up at small sizes for IDs and URLs.

**Why not Inter / Geist / Space Grotesk:** ubiquity. Modern minimalist done well needs typography that is its own voice, not the same voice as every other product in the category.

### 2.2 Weight subsets to ship

All three are variable faces, so one woff2 per family covers every weight we use.

- **Cabinet Grotesk (variable):** weight axis 100–900. Used at 500/700/800 for display.
- **Switzer (variable):** weight axis 100–900. Used at 400/500/600 for UI and body.
- **Spline Sans Mono (variable):** weight axis 300–700. Used at 400/500/600.

Self-host all three: the woff2 files live in each app's `public/fonts` and are declared with `@font-face` (web's `globals.css`, apex's `fontFaceCss()`). Do not call out to Google's or Fontshare's CDN from production — the content origin's CSP (ADR 0030) forbids it, and the trusted origin should match for consistency.

The shared token source is `@agent-paste/brand`. Both the web app (`apps/web/src/styles/globals.css`, guard-tested for parity) and the apex marketing worker derive their CSS variables and `@font-face` blocks from it, so the families above cannot drift between surfaces.

### 2.3 Scale

Use semantic tokens, not raw pixel sizes. Values below are the canonical ones in `@agent-paste/brand` (`TYPE`) and `globals.css`; do not redefine them per surface. The hero is fluid (one `clamp`); the rest are fixed steps so dense data lines up.

| Token            | Value                  | Line height | Letter spacing     | Weight | Use                              |
| ---------------- | ---------------------- | ----------- | ------------------ | ------ | -------------------------------- |
| `--text-hero`    | `clamp(60px,7vw,84px)` | ~0.95       | -0.03 to -0.04em   | 700    | Marketing hero, overview figure  |
| `--text-h1`      | 30                     | 1.1         | -0.02em            | 600    | Page title                       |
| `--text-h2`      | 20                     | 1.25        | -0.015em           | 600    | Section heading                  |
| `--text-h3`      | 15                     | 1.4         | -0.005em           | 600    | Card or subsection heading       |
| `--text-body`    | 14                     | 1.55        | 0                  | 400    | Default body                     |
| `--text-sm`      | 13                     | 1.5         | 0                  | 400    | Secondary text, table cells      |
| `--text-xs`      | 12                     | 1.4         | 0                  | 500    | Captions, footnotes, helper text |
| `--text-meta`    | 10.5                   | 1.3         | 0.04em (uppercase) | 600    | Eyebrow labels, table headers    |
| `--text-mono`    | 12.5                   | 1.55        | 0                  | 400    | Code blocks, the data rail       |
| `--text-mono-sm` | 11.5                   | 1.4         | -0.005em           | 500    | Inline IDs, timestamps           |

The scale is deliberately tight: most surfaces use only `--text-body`, `--text-sm`, the mono rail, and exactly one large element. The size jump from that one large element to the rail is the hierarchy — see §1 and §8.2. Restraint is what keeps it feeling considered.

### 2.4 Numerals

Numerals are tabular by default in tables, billing, dates, IDs, and any column-aligned data:

```css
font-variant-numeric: tabular-nums;
```

Headings can use proportional numerals for visual rhythm. Body copy follows context.

### 2.5 Heading discipline

One `--text-hero` per marketing page, never elsewhere. One `--text-h1` per page. Never skip levels (h1 → h2 → h3). If you want an h4, restructure — you are nesting too deep.

### 2.6 Italics

Switzer italic is restrained and pleasant; use it for emphasis on first use of a domain term ("the _Published Revision_") or quoted phrases. Avoid italic in tables and form labels.

---

## 3. Color System

### 3.1 Palette

These values are the canonical tokens in `@agent-paste/brand` (`DARK` / `LIGHT` in `tokens.ts`). `globals.css` is guard-tested to match them (`brand-tokens-parity.test.ts`) and apex emits them from the same package — **do not edit these triples in this doc as if it were the source; change `tokens.ts` and let both surfaces follow.** Stored as raw HSL triples so they reference cleanly from Tailwind v4 (`@theme`), `hsl(var(--foreground))` in hand-rolled CSS, or apex's inline style.

Dark is the bare `:root` (so SSR first paint is correct); light is the `[data-theme="light"]` alternate.

```css
:root {
  /* Neutral near-black ladder. Depth = lightness steps of a near-neutral hue. */
  --ink-0: 240 6% 5%; /* canvas */
  --ink-1: 240 7% 8%; /* raised surface */
  --ink-2: 240 7% 11%; /* hover / inset */
  --ink-3: 240 8% 14%; /* strong inset */
  --line: 240 8% 15%; /* hairline */
  --line-2: 240 7% 24%; /* hairline strong */

  /* Faintly warm off-white ink ramp, against the neutral dark. */
  --fg-0: 60 9% 95%; /* primary text */
  --fg-1: 240 5% 80%; /* secondary */
  --fg-2: 240 5% 55%; /* tertiary */
  --fg-3: 240 5% 38%; /* faint */

  /* The one voltage. Vermilion. */
  --vermilion: 10 100% 54%;
  --vermilion-dim: 10 78% 45%;

  /* Semantic only — never decorative. */
  --live: 152 56% 52%; /* published / live */
  --warn: 36 84% 58%;
  --gone: 4 72% 60%; /* destructive / deleted */
}

/* Dark: neutral near-black, the SSR default. */
:root,
[data-theme="dark"] {
  --background: var(--ink-0);
  --surface: var(--ink-1);
  --surface-2: var(--ink-2);
  --surface-3: var(--ink-3);
  --rule: var(--line);
  --rule-strong: var(--line-2);
  --foreground: var(--fg-0);
  --muted: var(--fg-1);
  --subtle: var(--fg-2);
  --faint: var(--fg-3);

  --accent: var(--vermilion);
  --accent-dim: var(--vermilion-dim);
  --accent-fg: 0 0% 100%;
  --accent-tint: 10 100% 54% / 0.14; /* low-alpha tint backgrounds */
  --selection: 10 100% 54% / 0.3;

  --success: var(--live);
  --warning: var(--warn);
  --destructive: var(--gone);
  --info: var(--fg-2);
}

/* Light — warm paper, vermilion stays the voltage. First-class, co-equal with dark. */
[data-theme="light"] {
  --background: 60 17% 98%;
  --surface: 0 0% 100%;
  --surface-2: 48 18% 94%;
  --surface-3: 45 16% 90%;
  --rule: 45 16% 88%;
  --rule-strong: 44 13% 80%;
  --foreground: 0 0% 4%;
  --muted: 60 4% 22%;
  --subtle: 0 0% 42%;
  --faint: 50 3% 60%;

  --accent: 10 100% 54%;
  --accent-dim: 10 82% 47%;
  --accent-fg: 0 0% 100%;
  --accent-tint: 10 100% 54% / 0.1;
  --selection: 10 100% 54% / 0.16;

  --success: 152 52% 36%;
  --warning: 32 80% 42%;
  --destructive: 4 66% 48%;
  --info: 60 4% 22%;
}
```

A high-contrast neutral button pair (`--primary` / `--primary-fg`) is derived in `@agent-paste/brand` as foreground-on-background, flipped, so the loudest neutral button is the inverse of the page. There are two compat aliases in `globals.css` (`--neutral-900`, `--neutral-50`) kept only so older chrome/form selectors resolve; they alias the ladder above and are not a separate palette.

### 3.2 Usage rules

- **Body text** is always `hsl(var(--foreground))`. **Secondary** is `hsl(var(--muted))`, **tertiary** `hsl(var(--subtle))`, **faint** `hsl(var(--faint))` (labels/timestamps only). Below faint, text is not readable — restructure rather than add a fifth tier.
- **The one accent does one job.** Use `--accent` for: the primary call-to-action, focus rings, selection, live/published state, and prose links in long-form content. Never two accents on a page, never a gradient of it, never an accent glow (a colored `box-shadow`). The neutral `--primary` pair is for high-emphasis neutral buttons where vermilion would be too loud.
- **Depth is the surface ladder, not shadows.** Nest by tone: `--background` (canvas) → `--surface` (panels, the transcript) → `--surface-2` (hover/inset) → `--surface-3` (strong inset). Separate with a 1px `--rule` (or `--rule-strong`). No drop shadow on a card (§4.5).
- **Selection background** is `--selection`; set it on `::selection`.
- **Color is never the only signal.** Pair every status hue with an icon, label, or text string.

### 3.3 Contrast targets

WCAG 2.1 AA is the floor. We test above it.

- `--foreground` on `--background` ≥ 12:1 (AAA easily)
- `--muted` on `--background` ≥ 4.5:1
- `--subtle` on `--background` ≥ 3:1 (do not use for body text)
- `--primary-fg` on `--primary` ≥ 7:1 (AAA)
- `--accent` on `--background` ≥ 4.5:1

Test both themes. Use the Chrome DevTools contrast checker on every text/background pair before merging.

### 3.4 Status hues at a glance

| State       | Token           | When                                                                      |
| ----------- | --------------- | ------------------------------------------------------------------------- |
| Default     | `--foreground`  | Everything not below                                                      |
| Success     | `--success`     | **Publish** succeeded, **Bundle** ready, **API Key** created              |
| Warning     | `--warning`     | **Safety Warning** present, **Auto Deletion** approaching, quota near cap |
| Destructive | `--destructive` | **Deletion**, **API Key Revocation**, **Access Link Lockdown** active     |
| Info        | `--info`        | **Draft Revision** waiting, **Upload Session** in progress                |

---

## 4. Spacing & Layout

### 4.1 Spacing scale

A 4px base. Use the token, not the raw pixel.

```css
--space-px: 1px;
--space-0-5: 2px;
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-20: 80px;
--space-24: 96px;
--space-32: 128px;
```

Do not invent intermediates. If 16px is too tight and 24px is too loose, the layout is wrong — do not reach for 20px to split the difference.

### 4.2 Vertical rhythm

The page is built on an 8px baseline grid. Body line-height (`1.55 × 14.5px ≈ 22.5px`) is close but not exact — that's fine. Layout-level vertical spacing uses scale tokens; type leading stays as defined.

### 4.3 Containers

```css
--container-prose: 62ch; /* docs, marketing copy, markdown render */
--container-narrow: 640px; /* settings forms, key-creation flows */
--container-default: 1040px; /* dashboard tables, artifact listings */
--container-wide: 1280px; /* full dashboard surface */
--container-bleed: 100%; /* hero, footer, marketing splash */
```

Centered with `margin-inline: auto`. Gutter is `--space-6` mobile, `--space-8` tablet, `--space-10` desktop.

### 4.4 Grid breakdown

The dashboard is two-column at ≥ 1024px: a 240px sidebar and a fluid main pane. Below 1024px, the sidebar collapses into a top sheet. Marketing pages have no sidebar; they use prose width for body copy and bleed for visual rest moments.

### 4.5 Borders before shadows

The default visual separator is a 1px hairline rule:

```css
border: 1px solid hsl(var(--rule));
```

Depth comes from the surface ladder plus that hairline (§3.2). **Shadows are overlay-only** — reserved for layers that genuinely float above the page (modals, dropdowns, popovers, toasts). They are neutral and soft, derived from the dark canvas:

```css
--shadow-overlay:
  0 1px 0 hsl(var(--rule)), 0 8px 24px -6px hsl(0 0% 0% / 0.4),
  0 24px 64px -24px hsl(0 0% 0% / 0.3);
```

Never put a shadow on a card, a panel, or the transcript — those are flat hairline-bordered surfaces. Never use an accent-tinted shadow (that is a glow, banned in §11). A card does not "lift" on hover; it shifts border-color or background (§7.2). This applies identically on both surfaces — the apex marketing home is squared to exactly this rule (its `index.test.ts` asserts no accent glow and no pill).

### 4.6 Radii

Square-ish. Radius is the exception, never the rule. Three tokens, all small — defined once in `@agent-paste/brand` (`RADII`):

| Token         | Value | Use                                                  |
| ------------- | ----- | ---------------------------------------------------- |
| `--radius-xs` | 2px   | Hairline chips, tight insets                         |
| `--radius-sm` | 3px   | Inline code, the brand mark, small chips             |
| `--radius-md` | 4px   | Buttons, inputs, cards, panels, the transcript shell |
| `50%`         | —     | Pips, dots, avatars (the only round shape we permit) |

No pills. There is no `--radius-lg`, no `9999px` capsule, no rounded-rect hero. A pill or a soft 10px+ corner reads as marketing-template; we are not marketing-template, and neither is the marketing surface.

---

## 5. Components

Canonical recipes. When extending, match the same token surface; do not introduce parallel tokens for one-off variations.

### 5.1 Button

```tsx
// variants
"primary"; // foreground bg, background text — one per view
"secondary"; // surface bg, foreground text, 1px rule border
"ghost"; // transparent bg, foreground text, hover surface
"destructive"; // destructive bg, white text
"link"; // inline, accent color, underlined on hover
```

Sizes: `sm` (28px tall, 13px text), `md` (34px tall, 14px text — default), `lg` (40px tall, 15px text).

Horizontal padding: `sm` 10px, `md` 14px, `lg` 18px.

**Focus ring:** 2px `--accent` outline at 2px offset. Never remove the outline without replacing it with another visible affordance.

**Loading state:** replace the label with a 14px dot trio (`···`) at 50% opacity, no spinner inside `sm` or `md` buttons (it shifts layout). For `lg` and async operations, an inline spinner is acceptable.

**Disabled state:** `opacity: 0.45`, `cursor: not-allowed`, no hover, `pointer-events: none` only when paired with a `title` or tooltip explaining why.

### 5.2 Input

```css
height: 34px; /* matches md button */
padding-inline: 12px;
border: 1px solid hsl(var(--rule));
background: hsl(var(--surface));
border-radius: var(--radius-sm);
font-family: var(--font-ui);
font-size: 14px;
color: hsl(var(--foreground));
```

**Focus:** border becomes `--accent`, add `box-shadow: 0 0 0 3px hsl(var(--accent) / 0.12)`. No heavy glow.

**Error:** border becomes `--destructive`, helper text appears below in `--text-xs` `--destructive`.

**Labels** are always above the input — never floating, never placeholder-as-label. Helper text sits beneath, separated by `--space-1`.

**Monospaced inputs** (Artifact ID, API Key prefix, idempotency key) set `font-family: var(--font-mono)` and `font-size: 13px`.

### 5.3 Table

Tables are how a workspace member reads their **Artifacts**, **Audit Events**, and **API Keys**. They are a first-class component, not a styled `<div>`.

```css
table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-variant-numeric: tabular-nums;
}

th {
  font: 600 11px/1.3 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: hsl(var(--muted));
  text-align: left;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid hsl(var(--rule-strong));
}

td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid hsl(var(--rule));
  font-size: 14px;
}

tbody tr:last-child td {
  border-bottom: none;
}

tbody tr:hover {
  background: hsl(var(--surface-sunken));
}
```

**ID columns** use mono, dimmed to `--muted`, first 8 characters always legible, remainder ellipsized at narrow viewports.

**Timestamp columns** use mono and a relative format (e.g. `3h ago`) with the full ISO string in a `title` attribute.

**Action columns** are right-aligned, contain at most one primary verb and a `⋯` overflow menu.

### 5.4 Card

```css
.card {
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-md);
  padding: var(--space-6);
}
```

Card header is `--text-h3` plus optional `--text-sm --muted` subtitle. Card actions sit top-right as ghost buttons or icon buttons. Card footer (if any) is separated by a 1px rule and uses `--space-4` vertical padding.

Do not nest cards. If you want to nest, the right shape is a list, a `<details>`, or a separate panel.

### 5.5 Badge / Status pip

Soft-filled badges. Restrained, not loud.

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font: 500 11px/1 var(--font-ui);
  letter-spacing: 0;
  padding: 3px 7px;
  border-radius: var(--radius-sm);
  background: hsl(var(--surface-sunken));
  color: hsl(var(--foreground));
  border: 1px solid hsl(var(--rule));
}

.badge[data-tone="success"] {
  color: hsl(var(--success));
  background: hsl(var(--success) / 0.08);
  border-color: hsl(var(--success) / 0.2);
}
.badge[data-tone="warning"] {
  color: hsl(var(--warning));
  background: hsl(var(--warning) / 0.1);
  border-color: hsl(var(--warning) / 0.24);
}
.badge[data-tone="destructive"] {
  color: hsl(var(--destructive));
  background: hsl(var(--destructive) / 0.08);
  border-color: hsl(var(--destructive) / 0.2);
}
.badge[data-tone="accent"] {
  color: hsl(var(--accent));
  background: hsl(var(--accent) / 0.08);
  border-color: hsl(var(--accent) / 0.2);
}
```

A **status pip** (inline with a row) is a 6px circle in the tone color, no border. Pips live inside tables; badges live above tables, on cards, and in headers.

**Canonical labels** for the domain — use these exact strings, in this case (sentence case, not uppercase):

- `Published` (success), `Unpublished` (neutral), `Draft` (accent)
- `Locked` (warning — **Access Link Lockdown**), `Revoked` (destructive)
- `Pinned` (accent), `Expiring` (warning), `Deleted` (destructive)
- `Safe` (neutral), `Warned` (warning — **Safety Warning** present)

### 5.6 Code block

Inline code:

```css
code {
  font: 500 0.92em/1 var(--font-mono);
  background: hsl(var(--surface-sunken));
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid hsl(var(--rule));
}
```

Block code:

```css
pre {
  font: 400 13px/1.55 var(--font-mono);
  background: hsl(var(--surface-sunken));
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-sm);
  padding: var(--space-4) var(--space-5);
  overflow-x: auto;
}
```

**Syntax highlighting palette:** derive from neutrals and the accent. Keywords use `--accent`, strings `--success`, comments `--subtle`, punctuation `--muted`. Avoid the default prism.css colors — they will fight the page.

When a code block contains an **Artifact ID**, **Revision ID**, or **Access Link URL**, ship a Copy affordance in the top-right corner. The button is `ghost` size `sm`, icon-only by default, label fades in on hover. See §5.11 for the copy interaction itself.

### 5.7 Empty state

Empty states are typography moments. A short heading, one body sentence, and one primary affordance. No illustration, no mascot.

```
[--text-h2]    No Artifacts yet.
[--text-body]  Publish your first one from the CLI:
[code]         npx @zaks-io/agent-paste publish ./report
[primary btn]  Create an API Key
```

Center the block vertically with `place-items: center` and a `max-width: 48ch`.

### 5.8 Toast / Notification

Top-right, fixed, `--surface` background with `--shadow-overlay`. Width 360px. Auto-dismiss after 6s for info/success; never auto-dismiss destructive. A toast carries one line of text and at most one action link. Multi-line state belongs in a banner or modal.

### 5.9 Modal sheet

Centered overlay at ≥ 768px, full-height bottom sheet on mobile. Backdrop is `hsl(0 0% 0% / 0.55)` (a touch lighter in light mode). Modal uses `--radius-md`, `--shadow-overlay`, and a top header with title (`--text-h3`) and close affordance. The modal is the one card-like surface that earns a shadow, because it genuinely floats.

Trap focus inside the modal. Restore focus to the trigger on close. Close on `Escape` and backdrop click only when the modal is non-destructive — destructive confirms (e.g. **Deletion**, **API Key Revocation**) require an explicit cancel.

### 5.10 Skeleton

Skeletons are subtle neutral bars with an opacity pulse. No moving shimmer gradient — it has become the universal AI-startup signal.

```css
.skeleton {
  background: hsl(var(--rule));
  border-radius: var(--radius-sm);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  50% {
    opacity: 0.55;
  }
}
```

### 5.11 Identifier — the signature interaction

This is the one element that gets disproportionate design attention. The product is about addressable **Artifacts** and **Revisions**; identifiers are the user's most-touched objects.

**Display:**

```css
.id {
  font: 500 13px/1.4 var(--font-mono);
  color: hsl(var(--muted));
  letter-spacing: -0.005em;
  cursor: copy;
  border-radius: 3px;
  padding: 1px 5px;
  margin: -1px -5px;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.id:hover {
  background: hsl(var(--accent) / 0.08);
  color: hsl(var(--foreground));
}

.id[data-copied="true"] {
  color: hsl(var(--accent));
}
```

**Behavior on click:** copy the full identifier to clipboard. No toast. The element briefly tints to `--accent` for 700ms then returns. The interaction is silent and reliable — the same way a good terminal interaction feels, without the terminal aesthetic.

**Long IDs** (e.g. `art_01HZ8K2X9NPQR3VW7TYBE5MCDF`) display the first 6 + last 4 characters by default with `…` between, and reveal the full string on hover via a `title` and on focus via an inline expansion. Copy always copies the full value.

This pattern applies to: **Artifact** IDs, **Revision** IDs, **API Key** prefixes, **Access Link** tokens, idempotency keys, and any other opaque identifier.

---

## 6. Iconography & Decoration

### 6.1 Icons

Use **Lucide**. 1.5px stroke at 16px and 20px display sizes. Always inherit `currentColor`.

Domain mapping (lock these so future agents don't drift):

| Concept                  | Icon                    |
| ------------------------ | ----------------------- |
| **Artifact**             | `file-stack`            |
| **Revision**             | `git-commit-horizontal` |
| **Workspace**            | `building-2`            |
| **Workspace Member**     | `user-round`            |
| **API Key**              | `key-round`             |
| **Access Link**          | `link`                  |
| **Share Link**           | `share-2`               |
| **Private Link**         | `lock`                  |
| **Access Link Lockdown** | `lock-keyhole`          |
| **Safety Warning**       | `triangle-alert`        |
| **Audit Event**          | `scroll-text`           |
| **Usage Policy**         | `gauge`                 |
| **Pinned Artifact**      | `pin`                   |
| **Bundle**               | `package`               |
| **Render Mode**          | `eye`                   |

Do not mix icon sets. If a concept doesn't exist in Lucide, draw it in the same weight (1.5px stroke, rounded caps, 16/20px frame).

### 6.2 Logo

The canonical wordmark is **`agent-paste.sh`**, set in the display face (Cabinet Grotesk) at the chrome size (~15px) with tight `letter-spacing: -0.03em`. It has three parts, always in these color roles:

- `agent` and `paste` in `--foreground`.
- the **hyphen** between them in `--accent` (the one place the wordmark carries voltage).
- the `.sh` TLD in `--subtle`, weight 600.

Optionally preceded by the brand mark (`brand-mark.png`) at the same height with a `--radius-sm` (3px) corner and **no ring, no shadow**. The mark is identical on both surfaces — apex (`apps/apex/src/components/chrome.tsx` + the `.wordmark*` rules in `styles.ts`) and web (`apps/web/src/components/chrome/Wordmark.tsx`). Keep them byte-for-byte in intent so they cannot drift; the web component's header comment points back here.

**The slash is not part of the mark.** A `/` only ever appears as a breadcrumb separator in chrome — between the wordmark and the current **Workspace** name in the dashboard topbar. It is path syntax, not branding. Do not render `agent/paste`.

### 6.3 Page chrome

Both surfaces share one chrome motif: a sticky top bar with the wordmark at the left and a 1px bottom rule.

- **Dashboard topbar:** wordmark (left), then ` / {Workspace name}` as the breadcrumb (§6.2), a command-palette trigger and the member avatar at the right. Flat against the canvas; the rule is its only edge.
- **Marketing topbar (apex):** the same wordmark at left, nav links centered, primary CTA at right. It is transparent at the top of the page and, once scrolled (`[data-stuck="true"]`), fades in a translucent `--background` fill with a `backdrop-filter: blur` and the bottom rule. This scroll-state backdrop is the **one** backdrop-filter we permit, and it is shared chrome behavior, not decoration — the dashboard topbar uses the same treatment when it overlays scrolling content.

The sidebar uses `--space-2` interior padding, items ~30px tall, label left-aligned with a 20px icon and a small gap. Active state: `--surface-2` background, no left bar, no icon color change — just the background shift. Quiet.

### 6.4 No decoration

There are no illustrations, mascots, sticker icons, or background patterns. There is no gradient mesh and no gradient fill anywhere — the accent is one flat color. The surface is dead flat: no grain overlay, no hero aura, no atmosphere layered behind the content. The system earns its character through type, color discipline, and interaction quality — not through ornamentation.

There are **no exceptions**. There is no grain texture and no hero radial; both were removed so every surface — dashboard and marketing — is the same flat canvas. Everything that was once a gradient (the old CTA wash, the accent glows, the orbit ring, the hero aura) has been removed so apex matches the dashboard.

If a surface feels like it needs decoration, it needs better typography and more whitespace.

---

## 7. Motion

### 7.1 Principles

- **Motion is feedback, not decoration.** Every animation answers a question: did my action register, where did this element come from, what just changed.
- **Default duration is 150ms.** Anything longer needs a justification.
- **One curve:** `--ease-out: cubic-bezier(0.16, 0.84, 0.3, 1)` (defined in `@agent-paste/brand` as `EASE_OUT`) for entrances and most state changes. Spring easing only via Motion One / Framer Motion, never CSS.
- **Reduced motion is honored.** Wrap every non-trivial transition in `@media (prefers-reduced-motion: no-preference)`. Replace movement with opacity changes.

### 7.2 Patterns

**Page enter:** main pane fades from `opacity: 0.7` to `1` over 180ms. No translation. Translations on page entry feel theatrical; opacity is correct.

**Toast enter/exit:** translate from `translateY(-8px)` and fade in over 160ms; exit translates back and fades over 140ms.

**Modal enter/exit:** backdrop fades over 140ms; sheet scales from `0.98` to `1` and fades over 160ms.

**Button press:** background transition over 80ms. No transform, no scale — pressed buttons should feel pressed, not bounced.

**Row hover:** background transition over 80ms.

**Identifier copy** (§5.11): 700ms total — instant color shift, hold ~500ms, fade back over 200ms.

**No infinite loops** outside skeletons and the **Upload Session** progress bar.

### 7.3 Where motion is forbidden

- Marketing hero text
- Identifiers and addresses (most important strings on the page — never animate)
- **Safety Warning** banners (must feel immediate)
- Form validation errors (instant under the field)
- Status badges (no pulse, no glow)

---

## 8. Surfaces

The product has four visually distinct surfaces. Each commits to the shared system (§0) — same tokens, same chrome, same discipline — and only tunes information density. The marketing worker and the dashboard are not two design systems; they are two layouts of one.

### 8.1 Marketing (`apps/apex`, `agent-paste.sh/`)

Server-rendered hono/jsx worker, CSS inlined from `@agent-paste/brand`. It shares the dashboard's exact discipline: square corners (`--radius-xs/sm/md`), depth from the surface ladder + 1px hairlines, no decorative drop shadows, no accent glows, no card hover-lifts, no gradient fills, no grain, no hero aura (§6.4). The topbar's scroll-state `backdrop-filter` is shared chrome (§6.3). `apps/apex/src/index.test.ts` asserts the no-pill / no-accent-glow / no-gradient rules so it cannot regress.

- Bleed-width hero: the brand mark (squared, no ring), an eyebrow with a flat live pip, the `--text-hero` headline (the accent appears only on the trailing stop), one lead paragraph, one primary CTA and one secondary arrow link.
- A flat, hairline-bordered transcript shell shows the product in use. Nothing in it animates.
- Feature / pillar / use-case sections are hairline-separated grids of flat `--surface` panels — hover shifts border-color and background, never position.
- The CTA is a flat hairline panel (no gradient overlay) with a squared install command box (no pill).
- Footer is a multi-column grid collapsing to fewer columns on small screens.
- **No carousels, no autoplaying video, no gradient washes, no hero aura, no "Featured in" logo strips, no testimonial slider, no card lifts.**

### 8.2 Dashboard (`apps/web`, `/app/*`)

Two-pane: a sidebar + main pane. Sidebar groups: **Overview**, **Artifacts**, **Access Links**, **API Keys**, **Audit Log**, **Workspace**, **Billing**.

Each main view opens with a `PageHeader`: page title (`--text-h1`) on the left, primary action on the right, one-line `--text-sm --muted` description below the title. Tables fill the remaining viewport; empty states follow §5.7. Detail views use a two-column layout: main content beside a metadata rail of key/value rows in `--text-sm`.

**The data-overview pattern (canonical).** This is the composition the rest of the system points back to for "hierarchy by scale" (§1). It is the dashboard's signature layout and the look the product is designed around:

- **One hero figure leads.** A single large display number (`HeroStat`, near `--text-hero` scale, tabular figures) carries the most important metric. Nothing else on the surface competes with it for size.
- **Everything else is a quiet mono rail.** Supporting metrics sit in a `StatBand` — small mono `--text-meta` labels over compact tabular figures, separated by hairlines, not boxed in shadowed cards.
- **Sections are hairline-separated**, built from `Card` (flat `--surface`, 1px `--rule`, `--radius-md`, no shadow) and `PageHeader`. Depth is the surface ladder, never a drop shadow.
- The interest comes entirely from the size jump between the one big figure and the small rail — different text sizes, tabular numerals, generous whitespace. That contrast _is_ the design; do not flatten it into uniform cards, and do not add a second loud element.

Real primitives: `apps/web/src/components/ui/HeroStat.tsx`, `StatBand.tsx`, `Card.tsx`, `PageHeader.tsx`, `Table.tsx`. Build new data overviews from these, not from new boxed-card layouts. This pattern is dashboard-only; do not port the big-figure overview onto the marketing surface.

### 8.3 Public **Artifact** view (`agent-paste.sh/r/{token}` and `app.agent-paste.sh/artifacts/{id}`)

- Centered single column at `--container-default` width.
- Top: **Display Metadata** title in `--text-h1`, **Artifact ID** as a §5.11 identifier in `--text-mono-sm`, **Workspace** attribution in `--text-sm`.
- Right rail (or below title on mobile): **Render Mode** badge, **Bundle** download link, **Safety Warning** banner if any.
- Main content area is an iframe to the content origin (ADR 0014, 0029). The frame chrome is part of the trusted page; the inner content is **Untrusted Content** and must not leak styling outward.
- Bottom: "View **Agent View**" link in mono, opens the JSON in a new tab.

### 8.4 Renderer pages (in `usercontent.agent-paste.sh`)

These render Markdown, text, and eventually directory listings for **Render Modes** that need it (ADR 0029). They live in the content origin with a strict CSP (ADR 0030), so fonts and styles must self-contain.

- **Markdown render:** prose at `--container-prose`, applies the full typography scale. Inline and block code per §5.6.
- **Text render:** mono at `--text-mono`, line numbers in `--subtle` if the file > 50 lines, wrap turned off.
- **Directory render:** a single-column table with name, size (mono, tabular), modified timestamp. No icons — keep the renderer JS bundle minimal.

These pages inherit the token system but ship a self-contained CSS file. They do not call into the trusted origin for fonts; subset Switzer and Spline Sans Mono into the renderer bundle.

---

## 9. Accessibility

WCAG 2.1 AA is the floor; §3.3 targets push past it.

- **Keyboard:** every interactive control reachable by `Tab`, operable by `Enter` / `Space`, exitable by `Escape` where it makes sense.
- **Focus order** follows visual order. Test with screen reader on.
- **Focus indicators** never disappear. Default `:focus-visible` is a 2px `--accent` outline at 2px offset. Inputs use the treatment in §5.2. Indicators must remain visible at 200% zoom.
- **Semantic HTML** is non-negotiable: `<button>`, `<a>`, `<table>`, `<dialog>` (or focus-trapped `<div role="dialog">`).
- **Live regions** for async changes: **Upload Session** progress, **Safety Warning** arrivals, **Publish** completion. `aria-live="polite"` for non-urgent, `assertive` for the rare urgent case.
- **Forms** always pair `<label>` with input via `for` / `id`. Helper text via `aria-describedby`. Errors via `aria-errormessage`.
- **Reduced motion:** §7.1.

Test paths: VoiceOver (macOS), NVDA (Windows), axe DevTools. Critical paths (publish, key creation, lockdown) must pass each before shipping.

---

## 10. Tailwind Integration

The dashboard uses Tailwind via the shadcn/ui convention (ADR 0033 leaves this open). Tokens are wired into Tailwind's `@theme` so utilities resolve to our values, not Tailwind's defaults.

```css
@import "tailwindcss";

@theme {
  --font-display: "Cabinet Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-ui: "Switzer", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Spline Sans Mono", ui-monospace, "SF Mono", monospace;

  --color-background: hsl(var(--background));
  --color-surface: hsl(var(--surface));
  --color-surface-sunken: hsl(var(--surface-sunken));
  --color-foreground: hsl(var(--foreground));
  --color-muted: hsl(var(--muted));
  --color-subtle: hsl(var(--subtle));
  --color-rule: hsl(var(--rule));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-fg));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-fg));
  --color-success: hsl(var(--success));
  --color-warning: hsl(var(--warning));
  --color-destructive: hsl(var(--destructive));
  --color-info: hsl(var(--info));

  --radius: var(--radius-md);
}
```

Use Tailwind utilities for layout and spacing. Use CSS modules or shadcn's `cn()` helper for component variants. Do not write inline `style` attributes for color or spacing — always go through tokens.

---

## 11. Anti-patterns

Things we have seen agents produce that violate the guide. Do not do these.

- **Gradient backgrounds or fills.** The vermilion accent is one flat color, never a gradient. There is **no** permitted gradient anywhere in the system — no hero aura, no CTA washes, no card gradients, no gradient hero text.
- **Accent glows.** An accent-tinted `box-shadow` (a glow) is banned. Shadows are neutral and overlay-only (§4.5).
- **Card hover-lifts.** No `translateY`/`translateX` on cards or buttons on hover. Hover shifts border-color or background, never position (§7.2).
- **Glassmorphism / backdrop-blur cards.** No. The only `backdrop-filter` is the shared topbar scroll-state (§6.3).
- **`agent/paste` with a slash in the wordmark.** The mark is `agent-paste.sh` (§6.2); the slash is a breadcrumb separator only.
- **Inter, Geist, or Space Grotesk as UI font.** Pick a different system, not this one.
- **"Hero with floating product screenshot"** marketing layouts. Replace with type.
- **Lottie animations** for empty states. Use type.
- **Multi-color accent palettes** ("primary purple, secondary green, tertiary pink"). One accent.
- **Pill-shaped buttons or capsules.** Use `--radius-md`; there is no `--radius-lg` and no `9999px`.
- **Drop-shadowed cards floating over solid backgrounds.** Use the surface ladder + rule.
- **Color-only state indication.** Always pair with icon or label.
- **"AI assistant" floating chat bubbles.** No.
- **Mascots, emoji decorations, sticker illustrations.** Infrastructure product, no mascot.
- **`Inter`** in any role. (Stated twice on purpose.)
- **Animated gradient hero text.** Set the type and let it speak.
- **Disabled buttons without explanation.** A `title` attribute is the minimum.
- **Placeholder text as label.** Label goes above.
- **Auto-playing media** of any kind.
- **Shimmer-gradient skeletons.** Use the opacity pulse in §5.10.
- **Toasts for routine confirmations** (copy, save). The interaction itself should signal success.
- **Decorative loading spinners** on buttons that complete in under 200ms. Skip the spinner.

---

## 12. Done definition for a new surface

A surface is ready to ship when:

- It uses only tokens from this guide; no hardcoded colors, font families, or spacing values outside the scale.
- It renders correctly in both `data-theme` values without code changes.
- Every interactive control has a visible `:focus-visible` indicator that passes 3:1 contrast.
- Every status conveyed by color is also conveyed by text or icon.
- The page passes axe DevTools with zero criticals.
- The page renders without layout shift on 3G throttling (skeleton state for any data > 100ms to fetch).
- Lighthouse Accessibility ≥ 95, Best Practices ≥ 95.
- Long-form text uses `--container-prose`; data-dense surfaces use `--container-default` or `--container-wide`.
- Numerals are tabular wherever they sit in a column.
- The build embeds only the font weights listed in §2.2.
- Identifiers use the §5.11 component, not raw `<code>` tags.
- A reviewer can read the surface end-to-end without encountering a single anti-pattern from §11.

If any one of these fails, do not merge. Fix the surface or open an ADR proposing a deliberate exception.
