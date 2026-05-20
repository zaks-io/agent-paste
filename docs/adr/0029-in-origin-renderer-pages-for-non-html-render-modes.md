# In-Origin Renderer Pages for Non-HTML Render Modes

The `content` worker serves a small platform-controlled renderer page (HTML+JS shipped with the worker) for each non-HTML, non-binary file **Render Mode** (`markdown` and `text` in the first implementation slice). The renderer fetches the underlying **Untrusted Content** from the same content origin and renders client-side. The iframe URL becomes `/v/{token}/_render/{mode}?path={path}`; the renderer reads its own URL to extract the signed token and builds child fetches that share the prefix. Directory rendering is reserved until the listing-source contract in [`content-rendering.md`](../specs/content-rendering.md) is settled.

## Considered Options

- Server-side render in the worker: collapses the request to one response, but pulls a Markdown parser and other rendering libraries into the trust boundary of the content origin and increases worker CPU per request.
- Raw bytes only (no renderer): simplest worker, but Markdown and text views show as raw bytes, which is not the intended viewer UX.
- Render in the `web` app and serve the rendered HTML from the content origin: requires uploading a derived rendered artifact per **Revision** and adds storage cost and retention rules for derived assets.
- Render in the `web` app and serve the rendered HTML from the trusted origin: ADR 0001 forbids serving **Untrusted Content** off the controlled content origin.

## Consequences

- Renderer pages live in the `content` source tree, are bundled into the worker, and ship as routes under `/v/{token}/_render/{mode}`.
- Renderers are subject to the same **Execution Policy** (ADR 0030) as any other content served from the origin; their inline scripts must comply with the same CSP.
- Directory **Render Mode** is not part of the first implementation slice. When it is implemented, it must still obey the rule that renderers never call `api` or `web`; the listing must be available through `content` after token verification.
- Adding a new platform-controlled **Render Mode** is a `content` worker change, not an upload-flow change.
- Renderers never call `api` or `web`; they only read from `content` itself using the inbound signed token.
- **Render Mode** resolution (which renderer the viewer reaches) happens upstream in `web` or `api` at mint time; `content` does not infer **Render Mode** from file extension.
