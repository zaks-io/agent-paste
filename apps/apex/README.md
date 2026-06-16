# apex

The marketing surface for `agent-paste.sh` and the home of agent-discoverable files (`/llms.txt`, `/agents.md`).

The apex never hosts authenticated state, never receives WorkOS callbacks, and never sets cookies. Any request that resolves to a product surface (`/dashboard`, `/artifacts/*`, `/keys`, `/audit`, `/settings`, `/admin/*`, `/al/*`, `/r/*`, `/login`, `/logout`, `/auth/*`) returns a 308 redirect to the equivalent path on `app.agent-paste.sh`.

Local preview with hot reload:

```sh
pnpm dev:apex
```

This serves the preview-shaped apex locally on `localhost:5174`, SSR-renders the static route table through Vite, and reloads the browser when prerendered page code changes.

## Social preview image

`public/agent-paste-social.svg` is the master. The committed
`public/agent-paste-social.png` is the og:image / twitter:image (social
scrapers do not render SVG). Regenerate it from the SVG with `rsvg-convert`
(from `librsvg`) so vector paths map 1:1 to output pixels:

```sh
rsvg-convert -w 1200 -h 630 --background-color white \
  public/agent-paste-social.svg -o public/agent-paste-social.png
```

Do not rasterize with ImageMagick `convert`/`magick`: without `librsvg` it
falls back to its internal MSVG renderer (weak anti-aliasing) and a
render-then-`-resize` pipeline resamples the bitmap, both of which blur the
text. Render directly at 1200×630, never resize.

Authoritative references:

- [ADR 0014](../../docs/adr/0014-single-domain-with-hardened-content-subdomain.md) — apex behavior and cookie boundary.
- [ADR 0033](../../docs/adr/0033-tanstack-start-for-the-web-app.md) — why `/llms.txt` and `/agents.md` live here and not on `app`.
- [Style Guide §8.1](../../docs/specs/style-guide.md) — marketing surface composition.
