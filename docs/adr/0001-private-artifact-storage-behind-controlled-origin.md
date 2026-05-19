# Private Artifact Storage Behind Controlled Origin

Artifact files will be stored in private object storage, with R2 as the preferred backing store, and served through a controlled artifact gateway on an isolated content origin rather than through direct public bucket URLs. The content origin must enforce access before serving bytes; otherwise it is not meaningfully different from exposing R2 directly. This keeps revocation, private workspace access, access-link reads, latest-versus-revision routing, response headers, and audit logging under platform control while still allowing uploaded HTML and JavaScript to run away from the app origin.

## Considered Options

- Public R2 bucket URLs: simple and cheap, but weakens revocation, policy enforcement, and response header control.
- Vercel-hosted artifact files: convenient for app deployment, but a poor fit for arbitrary folder-like asset storage.
- Private R2 behind a controlled origin: preserves object storage economics while keeping access and rendering policy centralized.

## Consequences

- Direct R2 read URLs must never be returned to agents or humans.
- Public read access should go through platform links and the enforcing content origin.
- Upload sessions may return short-lived signed write URLs for reserved object keys so uploads do not need to proxy bytes through the API.
