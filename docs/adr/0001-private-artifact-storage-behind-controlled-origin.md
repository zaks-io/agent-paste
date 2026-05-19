# Private Artifact Storage Behind Controlled Origin

Artifact files will be stored in private object storage, with R2 as the preferred backing store, and served through a controlled artifact gateway on an isolated content origin rather than through direct public bucket URLs. This keeps revocation, private workspace access, access-link reads, latest-versus-revision routing, response headers, and audit logging under platform control while still allowing uploaded HTML and JavaScript to run away from the app origin.

## Considered Options

- Public R2 bucket URLs: simple and cheap, but weakens revocation, policy enforcement, and response header control.
- Vercel-hosted artifact files: convenient for app deployment, but a poor fit for arbitrary folder-like asset storage.
- Private R2 behind a controlled origin: preserves object storage economics while keeping access and rendering policy centralized.
