# @agent-paste/brand

The single source of truth for brand design tokens shared across surfaces: the web
dashboard (`apps/web`) and the apex marketing worker (`apps/apex`).

It exists so brand color, type, and spacing cannot drift between the two apps the way
they did before (an emerald-teal landing page in front of a violet app).

## What's here

- `src/tokens.ts` - the tokens as typed objects: the neutral near-black surface ladder
  (dark) and warm paper ladder (light, co-equal), the one vermilion accent, semantic
  hues, radii, easing, the spacing and type scales, and the brand font definitions. HSL
  triples are stored without the `hsl()` wrapper so a consumer composes `hsl(<triple>)`
  or `hsl(<triple> / <alpha>)`.
- `src/index.ts` - helpers that emit CSS from the tokens:
  - `cssVarsBlock()` - a light `:root` plus a dark `prefers-color-scheme` override,
    mapped onto the `--name` custom properties both apps reference.
  - `fontFaceCss(basePath?)` - `@font-face` blocks for the three self-hosted variable
    faces (Cabinet Grotesk, Switzer, Spline Sans Mono).
  - `BRAND_MARK`, `FONTS`, `THEMES`, etc.

## How it's consumed

- **apex** imports the helpers and builds its inline `<style>` from them, so its CSS
  is derived from these tokens rather than hand-copied.
- **web** keeps authoring `src/styles/globals.css`, but a guard test asserts that the
  file's token values match this package, so the two stay in lock-step.

## Assets are not bundled

The brand mark and font woff2 are served as static files, so each app keeps a physical
copy in its own `public/` dir (the worker's `assets.directory`, Vite's `public/`). This
package holds the canonical filenames (`BRAND_MARK`, `BRAND_MARK_DARK`,
`BRAND_MARK_LIGHT`, `FONTS.*.file`), not the bytes. The dark and light brand mark
PNGs are transparent-background renders from their matching SVG sources.
`brand-mark.png` is the dark default used by the app today.

When the brand-mark PNGs, SVGs, or favicons change, update both app copies
together and keep the mark visually identical across surfaces.

## Discipline

One accent (vermilion, one job). Neutral near-black ladder (dark) and warm paper ladder
(light), both first-class; depth via lightness steps of a near-neutral hue. Square-ish
corners. Dead flat: no gradients, no grain, no glows, no second accent. Change a value
here and both apps move together; do not fork it back into an app's CSS.
