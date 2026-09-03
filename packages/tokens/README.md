# tokens

Shared signed-token package.

Responsibilities:

- `base64url(payload).hmac` codec.
- Constant-time HMAC helpers.
- Content-Gateway Token mint/verify helpers.
- Capability ID generation, validation, hostname parsing, and manifest codecs.
- Agent-View Token mint/verify helpers.
- Upload signed-URL token mint/verify helpers.

Runtime signing keys remain Worker secrets. This package owns token shape and verification behavior, not secret storage.
