# Secret Rotation Cadence and On-Demand Tooling

Status: Accepted. Updated after [ADR 0031](./0031-signed-content-urls-with-kid-rotation.md) was superseded by [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md).

The platform's rotatable secrets split into two groups by cadence. **Signing keys** — the HMAC secrets from ADR 0028 (content gateway URL signing) and ADR 0047 (Access Link signed URLs) — rotate automatically every 90 days through a scheduled remote agent that runs the staging-flip-drain playbook. The **API Key pepper** from ADR 0043 is the only remaining **storage-protection key** and rotates on demand only, with the rotation path continuously exercised by integration tests so the playbook is known to work without waiting for an incident. Most platform data is transient by default (ADR 0048), so storage-key exposure ages out naturally and a scheduled cadence is not worth the operational cost.

## Considered Options

- **Uniform cadence for every secret.** Simpler policy, but pepper rotation is more disruptive (existing **API Key** rows keep their original `kid` and rotate lazily) while signing-key rotation is cheap. Aligning them either over-rotates the pepper or under-rotates the signing keys.
- **Pepper on a yearly schedule.** Forces the rotation path to be exercised by reality once a year. Trade-off is real, but with transient-by-default artifacts the protected data has aged out long before the year ends, and integration-test exercise gives the same safety without a recurring operational task.
- **On-demand only for everything.** Untested rotation paths fail at the worst time. Signing keys especially need scheduled rotation because they sign continuously-issued bearer tokens and signed URLs; without rotation the exposure window grows monotonically.
- **Signing keys scheduled, pepper on demand with tested tooling (chosen).** Matches the threat profile: signing keys protect short-lived signed payloads at high volume; the pepper protects at-rest credentials with short data lifetimes.

## Consequences

- **Signing keys (ADR 0028, 0047): 90-day automatic rotation.**
  - A scheduled remote agent runs the rotation playbook every 90 days. The agent holds Cloudflare wrangler credentials scoped to updating Worker secrets and running the relevant scripts, nothing broader. Completion produces a notice; failures alert.
  - The playbook is the staging-flip-drain flow already in ADR 0028: stage the new `kid` in the verifying Worker, switch the signing Worker to mint with the new `kid`, accept both during the overlap window, drop the old `kid` once no in-flight payload can still use it.
  - The same playbook covers the **Access Link** signing key from ADR 0047 because it is the same HMAC-with-kid family. Old `kid`s remain valid for verify during overlap, so existing **Access Link** URLs continue to resolve until their `exp` or the overlap window closes.
  - Worst-case exposure of a leaked signing key is approximately 90 days plus the longest signed-payload TTL.
  - GitHub Actions cron is rejected for this task because it would require holding deploy-grade credentials in CI; the scheduled remote agent has narrower credentials and matches the existing dep-update pattern.
- **API Key pepper (ADR 0043): on-demand only with continuously tested tooling.**
  - No scheduled rotation. The operator triggers rotation when an incident, audit, or routine hygiene window warrants it.
  - The rotation tooling is reached through the operator-only admin surface on `api` per ADR 0046 (`POST /admin/rotations/api-key-pepper`); the CLI in `apps/cli` does not expose it. The scheduled agent authenticates to that endpoint with a **Cloudflare Access service token** (ADR 0046), not an Auth0/WorkOS machine flow and not an **API Key**; `requireOperator()` maps the service-token name to the reserved `rotation-agent@platform` identity.
  - **Integration tests exercise the full rotation path** on every PR that touches auth or pepper-handling code: mint an **API Key** under `kid=v1`, rotate to `kid=v2`, assert the key still verifies under the old `kid`, verify a fresh key uses `kid=v2`, drop `kid=v1`, assert old-`kid` keys now fail. The test is the safety net that an untested playbook would not provide.
  - The transient-default artifact lifecycle (ADR 0048) bounds the realistic exposure window of any stored credential, so the gap between scheduled and on-demand cadence is small in practice.
- **Emergency rotation.** Any suspected compromise triggers immediate rotation of the affected group, bypassing the schedule. The on-demand path is the same code path the scheduled rotation uses, so emergency rotation does not require new tooling.
- **WorkOS session secrets** (the AuthKit `WORKOS_COOKIE_PASSWORD` and `WORKOS_API_KEY` per ADR 0068) rotate through the WorkOS procedure tracked in `docs/ops/runbook-workos.md` and are not in scope here. Pepper rotation is independent of WorkOS secret rotation.
- **Routine rotation produces an op log, not an Audit Event.** Emergency rotation triggered by incident response generates an Audit Event in the incident-response workflow (out of scope here).
- **No CONTEXT.md change.** Rotation cadence is operational, not domain language.
