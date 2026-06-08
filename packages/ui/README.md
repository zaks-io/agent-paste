# @agent-paste/ui

The shared design-system surface imported by both the web dashboard (`apps/web`) and
the apex marketing site (`apps/apex`), so the two read as one product and cannot drift.

It depends on [`@agent-paste/brand`](../brand) for the raw tokens and turns them into the
concrete things the apps consume.

## What's here

- `src/styles/globals.css` — the complete Tailwind v4 stylesheet (token custom
  properties, the `@theme` mapping, base element styles, shared utilities, and
  keyframes). **It is generated**, not hand-authored: it is a snapshot of
  `globalsCss()` from `@agent-paste/brand`. Both apps import it via
  `@import "@agent-paste/ui/styles.css"`.
- `src/index.ts` — the barrel for shared React primitives (Button, Card, Badge, …).
  These land here as the web/apex primitives are unified.

## Regenerating the stylesheet

The CSS is a vitest file-snapshot of `globalsCss()`. After changing brand tokens:

```sh
pnpm --filter @agent-paste/ui test -u
```

The snapshot test (`test/globals-css.test.ts`) fails in CI if the committed
`globals.css` is out of date with the tokens, which is what keeps the design system
single-sourced. This replaced the old per-app `brand-tokens-parity` test: there is now
one generated source instead of two hand-authored copies guarded against each other.

## Consuming it

```ts
// In an app's entry CSS:
@import "@agent-paste/ui/styles.css";
```

The package must be declared as a dependency of the consuming app (pnpm's isolated
linker only links declared workspace deps), e.g. `"@agent-paste/ui": "workspace:*"`.
