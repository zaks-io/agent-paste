# Frontend Style Guide

The visual and interaction standard for everything humans see in **agent-paste**: the marketing surface, the workspace dashboard, the public **Artifact** view, and the renderer pages in the content origin. This document is the source of truth. If a component does not exist here, design it to extend this guide; do not invent a parallel system.

The audience is technical and discerning. Developers, agent builders, security-minded operators. They expect the UI to feel like a piece of professional software, not a marketing pitch. They expect dark mode to be as considered as light mode. They expect interactions to feel correct, not clever. This guide commits to that audience.

---

## 1. Aesthetic Direction: Quiet Confidence

The product is infrastructure. It should feel like infrastructure done well — restrained, considered, the kind of interface that gets out of the way and lets people work. Three commitments shape every decision below.

**Monochrome by default.** The system is built on a tight warm-neutral palette with high-contrast primary actions in straight foreground-on-background. Color appears only where it carries information: a single brand accent, three status hues, the user's content. A page can have zero non-neutral pixels and still feel finished.

**Typography over chrome.** Information hierarchy is established by type weight, size, and spacing — not by drop-shadowed cards, gradient backgrounds, or decorative borders. The default visual separator is whitespace; the secondary separator is a hairline rule; only modal layers earn shadows.

**One signature moment.** The product is fundamentally about addressable **Artifacts** and **Revisions**. The way we present identifiers — mono, tinted, silently copyable — is the signature interaction. Spend design budget here, not on hero animations.

**What we are not.** We are not a glassmorphism dashboard. We are not a purple-gradient hero. We are not a neon dark mode. We are not editorial / archival / terminal-themed. We are not chasing a metaphor. If a design choice would feel out of place at Linear, Stripe, or Resend, look closer; if it would feel _identical_ to any of them, look closer still.

---

## 2. Typography

### 2.1 Faces

Two faces. No third without an ADR.

| Role     | Family                    | Source       | Used For                                                                   |
| -------- | ------------------------- | ------------ | -------------------------------------------------------------------------- |
| **UI**   | Hanken Grotesk (variable) | Google Fonts | Everything: headings, body, labels, navigation, forms                      |
| **Mono** | JetBrains Mono            | Google Fonts | Code, **Artifact** IDs, **Revision** IDs, **Access Link** URLs, timestamps |

Hanken Grotesk is a humanist grotesque with slightly warmer proportions than Inter and a more grounded feel than Geist. It carries display, body, and UI roles without needing a separate display face — the difference between a 48px page title and a 14px label is weight and size, not family. JetBrains Mono is the developer-standard mono with sane disambiguation (`0`, `O`, `l`, `1`) and a calm rhythm that holds up at small sizes.

**Why not Inter / Geist / Space Grotesk:** ubiquity. Modern minimalist done well needs typography that is its own voice, not the same voice as every other product in the category.

### 2.2 Weight subsets to ship

Ship only the weights we use.

- **Hanken Grotesk (variable):** weight axis 400–700. Load the variable file once; let CSS choose the weight.
- **JetBrains Mono:** 400, 500.

Self-host via `@fontsource-variable/hanken-grotesk` and `@fontsource/jetbrains-mono`. Do not call out to Google's CDN from production — the content origin's CSP (ADR 0030) forbids it, and the trusted origin should match for consistency.

### 2.3 Scale

Use semantic tokens, not raw pixel sizes. The scale is anchored at 14px with a ratio of ~1.2.

| Token            | Px           | Line height | Letter spacing     | Weight | Use                              |
| ---------------- | ------------ | ----------- | ------------------ | ------ | -------------------------------- |
| `--text-hero`    | 56 / 64 / 72 | 1.0         | -0.025em           | 600    | Marketing hero only              |
| `--text-h1`      | 32           | 1.1         | -0.02em            | 600    | Page title                       |
| `--text-h2`      | 22           | 1.25        | -0.015em           | 600    | Section heading                  |
| `--text-h3`      | 16           | 1.4         | -0.005em           | 600    | Card or subsection heading       |
| `--text-lead`    | 17           | 1.55        | -0.005em           | 400    | Intro paragraph                  |
| `--text-body`    | 14.5         | 1.55        | 0                  | 400    | Default body                     |
| `--text-sm`      | 13           | 1.5         | 0                  | 400    | Secondary text, table cells      |
| `--text-xs`      | 12           | 1.4         | 0                  | 500    | Captions, footnotes, helper text |
| `--text-meta`    | 11           | 1.3         | 0.04em (uppercase) | 600    | Eyebrow labels, table headers    |
| `--text-mono`    | 13           | 1.55        | 0                  | 400    | Code blocks                      |
| `--text-mono-sm` | 12           | 1.4         | -0.005em           | 500    | Inline IDs, timestamps           |

The scale is deliberately tight: most surfaces use only `--text-body`, `--text-sm`, and one heading level. Restraint is what keeps it feeling considered.

### 2.4 Numerals

Numerals are tabular by default in tables, billing, dates, IDs, and any column-aligned data:

```css
font-variant-numeric: tabular-nums;
```

Headings can use proportional numerals for visual rhythm. Body copy follows context.

### 2.5 Heading discipline

One `--text-hero` per marketing page, never elsewhere. One `--text-h1` per page. Never skip levels (h1 → h2 → h3). If you want an h4, restructure — you are nesting too deep.

### 2.6 Italics

Hanken italic is restrained and pleasant; use it for emphasis on first use of a domain term ("the _Published Revision_") or quoted phrases. Avoid italic in tables and form labels.

---

## 3. Color System

### 3.1 Palette

Tokens stored as raw HSL triples so they reference cleanly from Tailwind v4 (`@theme`), shadcn/ui (`hsl(var(--foreground))`), or hand-rolled CSS without re-defining.

```css
:root {
  /* Primitives — never reference directly from components */
  --neutral-50: 36 14% 98%; /* #FBFAF8 — page background */
  --neutral-100: 36 10% 96%;
  --neutral-150: 36 8% 93%;
  --neutral-200: 30 6% 88%;
  --neutral-300: 28 5% 78%;
  --neutral-400: 26 4% 60%;
  --neutral-500: 24 4% 44%;
  --neutral-600: 24 5% 32%;
  --neutral-700: 24 6% 20%;
  --neutral-800: 24 8% 12%;
  --neutral-900: 24 10% 7%;
  --neutral-950: 24 12% 4%;

  /* Brand accent — deep emerald-teal */
  --accent-1: 162 60% 24%; /* #18553F — light mode primary */
  --accent-2: 162 55% 36%;
  --accent-3: 158 50% 52%; /* dark mode primary */

  /* Status — kept separate from accent */
  --signal-success: 152 48% 36%;
  --signal-warning: 32 78% 46%;
  --signal-error: 2 64% 48%;
  --signal-info: var(--neutral-600); /* info is just muted neutral */

  /* Semantic tokens — light */
  --background: var(--neutral-50);
  --surface: 36 16% 100%; /* slight lift above background */
  --surface-sunken: var(--neutral-100);
  --foreground: var(--neutral-900);
  --muted: var(--neutral-500);
  --subtle: var(--neutral-400);
  --rule: var(--neutral-200);
  --rule-strong: var(--neutral-300);

  --primary: var(--neutral-900); /* primary action is monochrome */
  --primary-fg: var(--neutral-50);

  --accent: var(--accent-1); /* prose links, focus rings, selection */
  --accent-fg: var(--neutral-50);
  --selection: 162 60% 24% / 0.16;

  --success: var(--signal-success);
  --warning: var(--signal-warning);
  --destructive: var(--signal-error);
  --info: var(--signal-info);
}

[data-theme="dark"] {
  --background: var(--neutral-950);
  --surface: var(--neutral-900);
  --surface-sunken: 24 14% 2%;
  --foreground: var(--neutral-100);
  --muted: 24 5% 62%;
  --subtle: 24 4% 44%;
  --rule: 24 8% 16%;
  --rule-strong: 24 8% 24%;

  --primary: var(--neutral-50);
  --primary-fg: var(--neutral-900);

  --accent: var(--accent-3);
  --accent-fg: var(--neutral-950);
  --selection: 158 50% 52% / 0.22;

  --success: 152 44% 56%;
  --warning: 32 78% 60%;
  --destructive: 2 64% 62%;
  --info: 24 5% 62%;
}
```

### 3.2 Usage rules

- **Body text** is always `hsl(var(--foreground))`. **Secondary text** is `hsl(var(--muted))`. **Tertiary** is `hsl(var(--subtle))`. Below subtle the text is not readable — restructure rather than add a fourth tier.
- **Primary action** uses `--primary` / `--primary-fg`. That is monochrome by design: the most important button on the page is foreground-on-background, inverted. There is at most one primary button per view.
- **Accent** is _not_ used for primary buttons. Accent is used for: prose links in long-form content (docs, marketing, **Markdown** render), focus rings, selection highlights, and badges/labels that mean "go", "valid", or "published". It is the brand color, deployed quietly.
- **Surfaces nest by tone**, not by stacking shadows: `--surface-sunken` (input wells, code blocks), `--background` (page), `--surface` (cards, modals, dropdowns).
- **Selection background** is `--selection`. Set it on `::selection`.
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

Shadows are reserved for floating layers (modals, dropdowns, popovers):

```css
--shadow-overlay:
  0 1px 0 hsl(var(--rule)), 0 8px 24px -6px hsl(var(--neutral-900) / 0.12),
  0 24px 64px -24px hsl(var(--neutral-900) / 0.08);
```

Do not put a shadow on a card just because the card is there. Cards earn shadows only when they hover, lift, or float.

### 4.6 Radii

| Token           | Value  | Use                                        |
| --------------- | ------ | ------------------------------------------ |
| `--radius-sm`   | 4px    | Inputs, small buttons, badges, code blocks |
| `--radius-md`   | 6px    | Default buttons, cards                     |
| `--radius-lg`   | 10px   | Modal sheets, large panels                 |
| `--radius-full` | 9999px | Avatars, status pips                       |

We do not use rounded pills for buttons. Pills read as marketing-template; we are not marketing-template.

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

Centered overlay at ≥ 768px, full-height bottom sheet on mobile. Backdrop is `hsl(var(--neutral-900) / 0.45)` light, `hsl(0 0% 0% / 0.65)` dark. Modal uses `--radius-lg`, `--shadow-overlay`, and a top header with title (`--text-h3`) and close affordance.

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

The wordmark is **agent-paste** set in Hanken Grotesk 700 with `letter-spacing: -0.02em`. Hyphen included, no separation. Two registered colorings: solid `--foreground`, or `--foreground` with the hyphen colored `--accent`. Nothing else.

### 6.3 Page chrome

The dashboard top bar is a 52px row containing the wordmark (left), a **Workspace** switcher (center-left), a global search trigger (center), and the member avatar (right). 1px bottom rule. No drop shadow, no backdrop blur.

The sidebar uses `--space-2` interior padding, items 30px tall, label left-aligned with a 20px icon and 10px gap. Active state: `--surface-sunken` background, no left bar, no icon color change — just the background shift. Quiet.

### 6.4 No decoration

There are no illustrations, mascots, sticker icons, or background patterns. There is no grain, no noise, no gradient mesh. The system earns its character through type, color discipline, and interaction quality — not through ornamentation.

If a surface feels like it needs decoration, it needs better typography and more whitespace.

---

## 7. Motion

### 7.1 Principles

- **Motion is feedback, not decoration.** Every animation answers a question: did my action register, where did this element come from, what just changed.
- **Default duration is 150ms.** Anything longer needs a justification.
- **Curves:** `--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)` for entrances and most state changes. `--ease-in: cubic-bezier(0.4, 0, 1, 1)` for exits. Spring easing only via Motion One / Framer Motion, never CSS.
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

The product has four visually distinct surfaces. Each commits to the shared system, but tunes the dials.

### 8.1 Marketing (`agent-paste.sh/`)

- Bleed-width hero: `--text-hero` title, one `--text-lead` paragraph below, one primary CTA, one secondary "View on GitHub" link.
- Below the hero, a code block showing `npx @zaks-io/agent-paste publish ./report` rendered with the standard `pre` style and a Copy affordance.
- The rest of the page is a single column at `--container-prose` width: feature sections separated by `--space-20`, each leading with a `--text-h2` and a one-paragraph body.
- Footer is a 4-column grid (Product / Docs / Company / Legal), collapsing to 2 on tablet and 1 on mobile.
- **No carousels, no autoplaying video, no animated background gradients, no "Featured in" logo strips, no testimonial slider.**

### 8.2 Dashboard (`/app/*`)

- Two-pane: 240px sidebar + main pane. Sidebar groups: **Artifacts**, **Access Links**, **API Keys**, **Audit Log**, **Usage Policy**, **Workspace**.
- Each main view opens with a header row: page title (`--text-h1`) on the left, primary action on the right, one-line `--text-sm --muted` description below the title.
- Tables fill the remaining viewport. Empty states follow §5.7.
- Detail views (single **Artifact**, single **API Key**) use a two-column layout: 2/3 main content, 1/3 metadata sidebar with key/value rows in `--text-sm`.

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

These pages inherit the token system but ship a self-contained CSS file. They do not call into the trusted origin for fonts; subset Hanken Grotesk and JetBrains Mono into the renderer bundle.

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
  --font-ui: "Hanken Grotesk Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", monospace;

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

- **Purple gradient backgrounds.** Banned on every surface.
- **Glassmorphism / backdrop-blur cards.** No.
- **Inter, Geist, or Space Grotesk as UI font.** Pick a different system, not this one.
- **"Hero with floating product screenshot"** marketing layouts. Replace with type.
- **Lottie animations** for empty states. Use type.
- **Multi-color accent palettes** ("primary purple, secondary green, tertiary pink"). One accent.
- **Pill-shaped buttons.** Use `--radius-md`.
- **Drop-shadowed cards floating over solid backgrounds.** Use the rule.
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
