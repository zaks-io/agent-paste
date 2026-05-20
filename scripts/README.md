# scripts

Implementation scripts live here.

## Planned Scripts

### `bootstrap-secrets.ts`

First-deploy secret bootstrap for one environment.

Required behavior:

- Accept target environment `preview` or `live`.
- Generate `CONTENT_GATEWAY_SIGNING_KEY_V1`, `ACCESS_LINK_SIGNING_KEY_V1`, `API_KEY_PEPPER_V1`, `OPERATOR_EMAILS`, and `WEB_SESSION_SEAL_KEY_V1`.
- Write Worker secrets through `wrangler secret put`.
- Print generated values once for password-manager capture.
- Refuse to overwrite existing secrets unless `--force` and a typed confirmation are provided.

This script is scaffolded as a requirement only; implementation comes with the deploy tooling pass.
