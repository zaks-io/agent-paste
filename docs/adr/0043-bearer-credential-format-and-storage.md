# API Key Bearer Format and Storage

Status: Accepted. Superseded in part by [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md), which removed Access Links from this bearer-credential family.

**API Key** secrets carry one string shape — `ap_pk_{env}_{publicId}_{secret}` — and one verification path: parse, look up by `publicId`, recompute HMAC, constant-time compare. The secret half of the credential is never persisted in plaintext; the row stores `HMAC_SHA_256(pepper, secret)` with the `pepper` held as a Worker secret. A DB breach without the pepper does not yield offline-testable hashes.

**Access Link** tokens used to share this same bearer-credential shape (`ap_al_{env}_...`) but have been moved to a signed-URL model under ADR 0047 (Access Link Signed URL with Fragment-Encoded Payload). The shared `ap_{type}_...` shape that originally motivated this ADR remains the API Key contract; the `al` family no longer exists.

## Considered Options

- **Plain SHA-256 of the full secret.** Cheap and adequate for 256-bit random tokens — brute force is infeasible regardless of hash speed. But a DB breach without the Worker secret would let an attacker test offline candidates against any known structure or recovered partial. HMAC with a pepper closes that hole at zero meaningful per-request cost.
- **bcrypt or Argon2.** Built for low-entropy human passwords. For 256-bit random tokens the latency adds nothing useful — the keyspace is already too large to brute force — and authenticated-request latency degrades.
- **HMAC-SHA-256 with peppered secret (chosen).** Constant-time verify, no offline cracking surface without the pepper, no per-request latency cost worth noting.

## Consequences

- **Format**: `ap_pk_{env}_{publicId}_{secret}`
  - `pk` is the credential-class marker for **API Key**. Future credential classes that ride this shape must use a distinct two-letter marker and update the parser; the `al` marker is reserved as deprecated and is not reused.
  - `env`: `production` or `preview` matching ADR 0012 (preview and production environments only). The pre-rename `live` segment is rejected; the project is pre-launch, so no `ap_pk_live_*` credentials were ever minted.
  - `publicId`: 16-character Crockford base32 (~80 bits), stored plaintext, indexed for O(1) lookup.
  - `secret`: 43-character base64url (256 bits of random entropy).
  - Example: `ap_pk_production_AB3CDEFGHJKLMN56_x9pQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrSt`.
- **Storage.** `api_keys.secret_hmac = HMAC_SHA256(pepper, secret)` where `pepper` is a Worker secret. Plaintext `secret` is never persisted. Verification recomputes the HMAC and constant-time compares.
- **Pepper rotation.** `api_keys.hmac_kid` carries the `kid` of the pepper that signed each row. Rotation is staged the same way ADR 0028 handles its signing keys: stage new pepper in the consumer, switch new keys to the new `kid`, accept both during overlap, drop old. Existing **API Keys** are not invalidated by pepper rotation because each stored HMAC keeps its original `kid`; new keys use the current `kid`. Pepper rotation is on-demand only per ADR 0045.
- **Authentication path.** Parse → reject malformed, wrong class prefix, or wrong `env` → look up by `publicId` → recompute HMAC under the row's `hmac_kid` → constant-time compare → enforce **Scopes** per ADR 0034. Failure paths return the generic envelopes from ADR 0036.
- **Length and shape stability.** The format is a contract. SDKs validate by regex. Secret-scanning detectors (GitHub, GitLab) ingest the `ap_pk_production_` and `ap_pk_preview_` prefixes once volume justifies registration. A future v2 format must use a distinct prefix family (e.g., `ap2_pk_`) so detectors and parsers coexist during migration.
- **Redaction.** Logs and audit summaries truncate the credential to `ap_pk_{env}_{publicId}…` — never the secret portion. The `publicId` is operationally useful for correlating without exposing the credential.
- **No env crossing.** A credential minted in `preview` is rejected in `production` and vice versa. This catches the most common credential-pasting mistake at parse time, before any DB lookup.
- **`al` prefix is permanently retired.** The `ap_al_*` family was introduced by an earlier draft of this ADR and superseded by ADR 0047 before any **Access Link** token reached production. The parser rejects `ap_al_*` strings outright; secret-scanning detectors are not registered for this family.
- **CONTEXT.md** carries **API Key Bearer Format** as a glossary term with relationships pinning the `ap_pk_...` shape, the HMAC storage rule, the `env` segregation rule, and the redaction rule. **Access Link** carries no bearer-credential relationships; the relationships for the signed-URL model live under ADR 0047.
