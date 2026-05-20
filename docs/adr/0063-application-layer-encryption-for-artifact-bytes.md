# Application-Layer Encryption for Stored Artifact Bytes

All **Revision** file bytes and generated **Bundle** archives are encrypted at the application layer with AES-256-GCM before the R2 PUT. The data encryption key is derived per-**Workspace** from a Worker-held root encryption key using HKDF-SHA-256 with the **Workspace** id as the `info` parameter; the root key is held as a Worker secret in `upload`, `jobs`, and `content` only, and joins the 90-day signing-key rotation set from [ADR 0045](./0045-secret-rotation-cadence-and-on-demand-tooling.md). The encryption `kid` lives in R2 `customMetadata` next to the object so `content` derives the right root key on read without a database lookup. R2's at-rest server-side encryption remains in place underneath; this is defense-in-depth, not a replacement.

## Considered Options

- **Rely on R2 server-side encryption only.** Simpler — R2 encrypts at rest with platform-managed keys. Rejected because the threat profile we accept includes Cloudflare-side bucket misconfiguration and operator-tier access to the underlying object store; relying solely on the platform key keeps Cloudflare inside the trust boundary for byte confidentiality. The 90-day staging-flip-drain playbook already exists for content-gateway and **Access Link** signing keys per ADR 0045, so the marginal operational cost of adding one more rotation set is small.
- **One platform-wide DEK.** Simpler key management; weaker isolation. Rejected because per-**Workspace** derivation gives tenant-scoped blast radius (a compromised DEK touches one tenant's bytes, not the platform's) for the cost of one HKDF call per upload session.
- **Per-Revision DEK.** Maximum isolation; maximum complexity. A `kid → key` map per **Revision** is unmaintainable, and deriving per-**Revision** from the per-**Workspace** key adds nothing because the **Workspace** boundary is already the access boundary — a viewer who can read one **Revision** through an **Access Link Signed URL** can read every retained **Revision** the **Workspace** chooses to expose. Rejected.
- **Encrypt only sensitive uploads (opt-in).** Surfaces an "encrypted vs. not" axis to agents and to ops, increases the chance of an unencrypted leak, and requires new glossary terms. Rejected; uniform encryption is the simpler invariant to maintain.

## Consequences

### Cryptographic shape

- **Algorithm.** AES-256-GCM, 96-bit random IV per object, 128-bit authentication tag appended. Web Crypto's `crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, plaintext)` is the canonical path.
- **Key derivation.** `DEK = HKDF-SHA-256(rootKey[kid], salt=workspaceId, info='agent-paste/artifact-bytes/v1', length=32)`. The `kid` lives in R2 `customMetadata`; the `rootKey[kid]` lives as a Worker secret in `upload`, `jobs`, and `content` only.
- **IV / nonce.** 96 bits from `crypto.getRandomValues`, written as the first 12 bytes of the stored ciphertext object. Reuse of a `(key, IV)` pair is catastrophic for GCM; random 96-bit IVs at per-**Workspace** key scope give a comfortable margin for the expected upload volume per **Workspace**.
- **AAD.** `(workspaceId, artifactId, revisionId, normalizedPath)` is bound as Additional Authenticated Data so a confusion between two objects fails the GCM tag verification before any byte is served.

### Worker responsibilities

- **`upload` encrypts before R2 PUT.** Signed PUT URLs from [ADR 0027](./0027-upload-write-path.md) cannot encrypt server-side after the agent's upload, so the agent uploads ciphertext-bearing PUTs *through* an `upload` route that wraps the body in a `TransformStream` performing AES-GCM as it forwards to R2. The signed-URL pattern is retained for the per-**Upload Session** capacity allocation and reserved-key semantics; the bytes do not go straight from agent to R2.
- **`jobs` encrypts Bundle outputs** with the same per-**Workspace** DEK before the bundle PUT, using the same `info` and AAD shape with `normalizedPath = 'bundle.zip'`.
- **`content` decrypts on read** inside the existing content-gateway-token verification path per [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md). The decrypt is streamed into the response body so multi-megabyte payloads do not buffer in memory.
- **`api` has no encryption binding.** **Manifests**, **Display Metadata**, **Audit Events**, and **Change Summaries** remain in Postgres unencrypted at the application layer; they are platform-controlled, queryable by design, and protected at rest by Postgres and the hosting provider.

### R2 object metadata

| `customMetadata` field | Value | Purpose |
|---|---|---|
| `enc_kid` | The root-key `kid` used to derive the per-**Workspace** DEK | `content` selects the correct root key during the overlap window. |
| `enc_alg` | `aes-256-gcm` | Algorithm marker; lets a future v2 format co-exist with v1 ciphertexts in the same bucket. |
| `enc_aad_v` | `v1` | Version of the AAD composition rule above. |

R2 object keys remain ID-based per [ADR 0021](./0021-id-based-r2-object-key-layout.md). Encryption changes neither the key layout, the upload-session reservation flow, nor finalize verification.

### Key rotation

- The root encryption key joins the 90-day rotation set defined by ADR 0045. Adding it is a config change for the scheduled rotation agent; no new playbook.
- Existing objects keep their original `kid` in `customMetadata`. `content` holds `{kid → rootKey}` for the current key and the previous one during the overlap window, mirroring the content-gateway signing keys. Objects encrypted under a dropped `kid` are unreadable; the drop step waits until no retained **Revision** of that age can still be served, bounded under **Auto Deletion** and the transient-by-default policy of [ADR 0048](./0048-transient-artifacts-by-default.md).
- The `info` string `agent-paste/artifact-bytes/v1` is part of the derivation, so a v2 algorithm or AAD shape can co-exist with v1 ciphertexts without ambiguous decrypts.
- Emergency root-key rotation reuses the on-demand path; no separate tooling. Existing-object re-encryption is *not* part of routine rotation — old ciphertexts age out under normal lifecycle.

### Trade-offs accepted

- **CPU on every content read.** AES-GCM decrypt runs on `content` for every served byte. Streaming decrypt via Web Crypto adds CPU and a small per-response latency floor; for typical text/markdown/HTML payloads this is negligible, for multi-megabyte bundles it is measurable. We accept this for a stronger trust boundary against Cloudflare-side insider and misconfiguration risk.
- **Upload bytes transit `upload`.** Signed direct-to-R2 PUTs no longer deliver bytes that bypass our Workers. ADR 0027's reservation semantics are retained; the bytes flow through `upload` so the encryption transform can run.
- **R2 dashboard previews show ciphertext.** Intentional. Ops debugging uses `content` paths, not the bucket browser.
- **No full-bucket re-encrypt path.** Rotation creates new objects under the new `kid`; old objects stay under their original `kid` until normal lifecycle removes them. If a forced re-encrypt ever becomes necessary, it is a one-off operator job, not a routine path.
- **Threat model is platform-tier, not viewer-tier.** A leaked **Access Link Signed URL** still grants the bytes it was minted for; encryption does not weaken or strengthen that. The defended-against scenarios are R2 misconfiguration (objects exposed without going through `content`) and platform-tier access to the underlying object store.

### What this ADR does not change

- **CONTEXT.md** does not gain an "encrypted artifact" glossary term. The bytes a **Revision** stores remain the same product concept; encryption is an implementation property of the storage layer.
- **Untrusted Content** semantics per [ADR 0024](./0024-treat-agent-provided-data-as-untrusted.md) are unchanged. The content is still untrusted to the platform regardless of whether it was encrypted on the way in.
- **R2 lifecycle and at-rest encryption** are unchanged. Cloudflare's at-rest encryption sits underneath; this ADR adds a second layer on top.
- **Bundle Availability** transitions per [ADR 0050](./0050-bundle-availability-and-asymmetric-dlq-consumption.md) are unchanged. An encryption error during bundle generation is a generation failure that transitions **Bundle Availability** to `failed` with no effect on the underlying **Revision**.
