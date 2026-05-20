# Strict Extension-Based Served Content Type at `content`

The `content` worker derives the `Content-Type` header from a fixed file-extension allowlist baked into the worker, ignoring any MIME value the agent supplied at upload time. Unrecognized extensions are served as `application/octet-stream` with `Content-Disposition: attachment` so they download rather than render. Text types carry `; charset=utf-8` to defeat browser charset-sniffing. SVG renders inline but the response carries a tightened **Execution Policy** that blocks `<script>` execution inside the SVG, so a malicious SVG cannot turn into an XSS vector even when opened as a top-level document.

## Considered Options

- **Echo the agent-provided Content-Type.** Maximum flexibility, minimum safety. Upload `image.png` with `Content-Type: text/html` and the browser renders it as HTML; combined with the CSP's `'self'` script source from ADR 0030, the file executes as a script in the workspace's own content origin.
- **Sniff bytes (magic-byte detection).** Robust against extension forgery but expensive, and polyglot files (valid PNG plus valid HTML in one file) make the answer ambiguous. Adds CPU per request without removing the underlying decision.
- **Force every file to `application/octet-stream`.** Maximum safety, terrible UX. Agents cannot publish a working HTML artifact.
- **Extension-based allowlist with strict defaults (chosen).** Predictable for agents, safe by default, composes with the filename normalization rules in ADR 0021 and the `nosniff` declaration in ADR 0030.

## Consequences

- **Allowlist lives in the `content` worker.** Adding a MIME mapping is a `content` deploy, not a workspace setting. Initial set covers HTML, CSS, JS, JSON, plain text, Markdown, PNG, JPEG, GIF, WebP, SVG, PDF, MP3, WAV, MP4, WebM. Future extensions are added explicitly.
- **Unknown extension** → `application/octet-stream` with `Content-Disposition: attachment; filename="{basename}"`. Forces download with a safe filename; nothing renders inline.
- **Text types carry `; charset=utf-8`.** Applies to `text/html`, `text/css`, `application/javascript`, `application/json`, `text/plain`, `text/markdown`. Defense in depth against UTF-7 / charset-confusion XSS patterns that pre-date `nosniff`.
- **SVG renders inline with a tightened per-response CSP.** SVG responses carry `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:`, overriding the base CSP from ADR 0030. The browser applies the response CSP when the SVG loads as a top-level document or inside an `<iframe>`, so embedded `<script>` elements within the SVG cannot execute. When the SVG loads as `<img src=...>` inside an HTML artifact the embedded scripts already cannot execute (image rendering context); the tightened CSP closes the top-level-navigation hole.
- **Renderer pages exempt.** Renderer pages served by `content` per ADR 0029 (in-origin renderers) declare their own `Content-Type` and CSP and are not routed through the allowlist.
- **Agent-provided `Content-Type` at upload time is ignored.** The upload PUT URL accepts the bytes; the served type is determined by `content` at read time from the normalized file extension. This decouples upload mechanics from content-rendering policy.
- **CONTEXT.md** adds **Served Content Type** as a glossary term and pins the rule to the file extension, with explicit relationships covering the unknown-extension default, the charset rule, and the SVG case.
- **Agents discover supported extensions through trial.** No pre-flight endpoint enumerates the allowlist in the MVP; an unsupported extension surfaces as download-only behavior at read time.
- **No error envelope for Content-Type decisions.** The response is the file. The allowlist applies silently. Failure to render an unknown extension is not a server error; it is the intended safe default.
