# apex

The marketing surface for `agent-paste.sh` and the home of agent-discoverable files (`/llms.txt`, `/agents.md`,
`/.well-known/api-catalog`). The homepage response also carries the RFC 8288 `Link` header that points at them;
both come from `src/discovery.ts`. See [API discovery](../../docs/specs/api.md#api-discovery). Skills are
published separately at `/.well-known/agent-skills/`; see [Agent skills discovery](#agent-skills-discovery).

The apex never hosts authenticated state, never receives WorkOS callbacks, and never sets cookies. Any request that resolves to a product surface (`/dashboard`, `/artifacts/*`, `/keys`, `/audit`, `/settings`, `/admin/*`, `/al/*`, `/r/*`, `/login`, `/logout`, `/auth/*`) returns a 308 redirect to the equivalent path on `app.agent-paste.sh`.

Local preview with hot reload:

```sh
pnpm dev:apex
```

This serves the preview-shaped apex locally on `localhost:5174`, SSR-renders the static route table through Vite, and reloads the browser when prerendered page code changes.

## Agent skills discovery

apex publishes the repo's skills under `/.well-known/agent-skills/` per the
[Agent Skills Discovery RFC](https://github.com/cloudflare/agent-skills-discovery-rfc)
v0.2.0:

- `/.well-known/agent-skills/index.json` — the discovery index (`$schema`, one entry per skill).
- `/.well-known/agent-skills/<name>/SKILL.md` — the skill artifact each entry points at.

The top-level [`skills/`](../../skills) directory is the only source. `scripts/prerender.mjs`
copies each `SKILL.md` into `dist/client` verbatim and derives its `sha256:` digest from
those same bytes, so the published artifact, its advertised digest, and the copy agents
install from GitHub can never disagree. Adding a skill means adding
`skills/<name>/SKILL.md`; the index picks it up on the next build. The build fails if a
skill's frontmatter `name` is missing, malformed, or disagrees with its directory.

The Cloudflare asset server types these correctly on its own (`application/json` and
`text/markdown`); the worker only stamps `Access-Control-Allow-Origin: *` on the prefix
so browser-based clients can read them.

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
