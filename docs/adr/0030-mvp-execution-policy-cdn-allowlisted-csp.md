# MVP Execution Policy: CDN-Allowlisted CSP for Untrusted Content

The single MVP **Execution Policy** allows uploaded HTML to load scripts, styles, and fonts from a small allowlist of common CDNs so agents can build rich interactive visualizations, while keeping every data-egress channel — `connect-src`, `img-src`, `media-src`, `form-action`, `frame-src` — locked to the content origin, `data:`, or `blob:`. The hosting iframe on `web` uses `sandbox="allow-scripts allow-popups"` (no `allow-top-navigation`, no `allow-same-origin`) so artifact JavaScript cannot nav-exfil through the top frame.

## Considered Options

- Strict `script-src 'self'` only: safest but blocks the common pattern of agent-generated HTML loading `<script src="https://cdn.jsdelivr.net/...">` for visualization libraries.
- Wide `script-src 'self' 'unsafe-inline' 'unsafe-eval' https:`: any HTTPS origin can host loaded scripts; more permissive than an allowlist and harder to reason about origin trust.
- Open `connect-src https:` or `img-src https:`: enables live-data visualizations but adds direct exfiltration channels that defeat the goal of ADR 0003.
- No CSP at MVP: violates ADR 0003 and cannot tighten later without breaking artifacts that came to depend on the openness.

## Consequences

- Every response from `content` for **Untrusted Content** carries:
  - `Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors https://agent-paste.sh https://app.agent-paste.sh`
  - `Referrer-Policy: no-referrer` (the signed token lives in the URL path and must not leak via `Referer`)
  - `Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()`
  - `X-Content-Type-Options: nosniff`
  - `Cross-Origin-Resource-Policy: cross-origin`
  - `Cross-Origin-Opener-Policy: same-origin`
- `frame-ancestors` limits embedding to `https://agent-paste.sh` and `https://app.agent-paste.sh` per ADR 0014.
- Renderer pages (ADR 0029) and platform error pages must comply with the same policy.
- Adding or removing an allowlisted CDN is a `content` worker change and a contract change for agents that hard-coded the prior list; future tightening (for example, removing `'unsafe-eval'` or dropping `https://unpkg.com`) is allowed to break existing artifacts that depended on the looseness.
- Per-**Workspace** or per-**Artifact** custom **Execution Policy** is out of scope for the MVP (CONTEXT.md: "The MVP uses one fixed Execution Policy for all Untrusted Content").
- The `web` app is responsible for setting the `sandbox` attribute on the viewer iframe; `content` cannot enforce iframe sandboxing on the embedder.
