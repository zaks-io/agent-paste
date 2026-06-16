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
scrapers do not render SVG). Regenerate it by supersampling: render the SVG at 4× with `rsvg-convert` (from
`librsvg`), then downscale to 1200×630 with a Lanczos filter. The wordmark is
outlined curved type, so its edges always anti-alias; supersampling averages
that anti-aliasing into the cleanest 1× edges.

```sh
rsvg-convert -w 4800 -h 2520 --background-color white \
  public/agent-paste-social.svg -o /tmp/social-4x.png
magick /tmp/social-4x.png -filter Lanczos -resize 1200x630 -strip \
  public/agent-paste-social.png
oxipng -o max --strip safe public/agent-paste-social.png  # lossless ~30% smaller
```

Use `rsvg-convert` for the render, not ImageMagick's internal MSVG renderer
(weak anti-aliasing): a bare `magick social.svg ...` without `librsvg` installed
silently falls back to MSVG and looks worse.

Authoritative references:

- [ADR 0014](../../docs/adr/0014-single-domain-with-hardened-content-subdomain.md) — apex behavior and cookie boundary.
- [ADR 0033](../../docs/adr/0033-tanstack-start-for-the-web-app.md) — why `/llms.txt` and `/agents.md` live here and not on `app`.
- [Style Guide §8.1](../../docs/specs/style-guide.md) — marketing surface composition.
