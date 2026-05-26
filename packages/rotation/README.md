# @agent-paste/rotation

Tested multi-key and multi-pepper rotation primitives for ADR 0045.

- **Signing key ring** — staged verify-old / sign-new / drop-old for HMAC signing secrets (`CONTENT_SIGNING_SECRET`, `UPLOAD_SIGNING_SECRET`, and optional `*_V2` overlap bindings).
- **Pepper ring** — same overlap model for `API_KEY_PEPPER_V*` with per-row `pepper_kid` on `api_keys`.

Workers and repositories import this package; production secret values are never logged. Integration tests exercise the full overlap playbook on every PR that touches rotation consumers.
