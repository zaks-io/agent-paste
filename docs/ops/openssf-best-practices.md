# OpenSSF Best Practices Badge — self-assessment

Tracks agent-paste against the [OpenSSF Best Practices Badge](https://www.bestpractices.dev/)
criteria. This is the badge referenced in
[ADR 0076](../adr/0076-public-open-source-security-posture-and-badges.md) and the
public-repo line of [security-todo.md](./security-todo.md), aggregated under
[AP-254](https://linear.app/zaks-io/issue/AP-254).

**Target tier: Passing.** Silver is self-assessed below to show the gap; Gold is
out of scope (see "Tiers" below). The repo went public on 2026-06-08, so the ADR
0076 precondition (no private-repo posture represented as a public badge) is
cleared and the badge can now be applied for. The badge program is
_self-certified_: every answer must be truthful and inspectable, so this doc only
claims what the repo actually does today.

## Tiers (and why Gold is out of scope)

`bestpractices.dev/en/criteria/{0,1,2}` = Passing / Silver / Gold.

Gold requires two criteria a single-maintainer project structurally cannot meet,
and no repo work changes that:

- `bus_factor` ≥ 2
- `contributors_unassociated` — "at least two unassociated significant
  contributors" (two significant contributors from different organizations)

agent-paste is currently a solo project. Gold is revisited only if/when a second
independent maintainer is established. Do not attest to these to "get Gold" — a
false self-certification destroys the credibility the badge exists to signal.

## Passing — criterion status

All Passing MUSTs are met (the two former gaps were closed in this change). Paste
the justification text into the matching field on the bestpractices.dev form.

| Criterion                                                   | Status | Evidence                                                                                                                                                           |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `repo_public` / `repo_distributed`                          | met    | git; repo public since 2026-06-08 (AP-254 flip)                                                                                                                    |
| `repo_track` / `repo_interim`                               | met    | full git history; reviewable diffs                                                                                                                                 |
| `sites_https`                                               | met    | apex + web + API on Cloudflare Workers, TLS everywhere; download is GitHub Releases / npm (HTTPS)                                                                  |
| `contribution`                                              | met    | [`CONTRIBUTING.md`](../../CONTRIBUTING.md) explains branch/commit/PR flow                                                                                          |
| `contribution_requirements`                                 | met    | `CONTRIBUTING.md` — Conventional Commits, `pnpm verify`, coverage gate, test policy                                                                                |
| `floss_license` / `license_location`                        | met    | Apache-2.0 in [`LICENSE`](../../LICENSE) + [`NOTICE`](../../NOTICE); `package.json` `"license"`                                                                    |
| `version_unique` / `version_semver`                         | met    | semver in `apps/cli/package.json`; release tags `cli-v<version>`                                                                                                   |
| `release_notes`                                             | met    | `.github/workflows/cli-release.yml` uses `gh release create --generate-notes` (PR/commit changelog since the prior `cli-v*` tag) plus a static supply-chain footer |
| `report_process` / `report_tracker`                         | met    | public GitHub Issues feed the Linear `AP-` queue (GitHub→Linear sync); `CONTRIBUTING.md` documents the path                                                        |
| `vulnerability_report_process`                              | met    | [`SECURITY.md`](../../SECURITY.md) — private GitHub advisories + `isaac@zaks.io`                                                                                   |
| `vulnerability_report_private`                              | met    | `SECURITY.md` provides a private channel (advisories), not a public issue                                                                                          |
| `vulnerability_report_response` (≤14 days)                  | met    | `SECURITY.md` commits to acknowledgement within 5 business days                                                                                                    |
| `build` / `build_common_tools`                              | met    | `pnpm build` (Turborepo); Node from `.nvmrc`, Corepack pnpm; [`docs/development.md`](../development.md)                                                            |
| `installation_common`                                       | met    | `npx @zaks-io/agent-paste`; `docs/development.md` for source builds                                                                                                |
| `warnings` / `warnings_fixed`                               | met    | Biome lint + `tsc` typecheck in `pnpm verify`; clean is required to merge                                                                                          |
| `warnings_strict`                                           | met    | strict TypeScript; Biome rules in `biome.json`                                                                                                                     |
| `test` / `test_invocation`                                  | met    | vitest; `pnpm test` (PGlite in-memory Postgres, no Docker)                                                                                                         |
| `test_most`                                                 | met    | coverage floors 88/82/88/88 (statements/branches/functions/lines), enforced in CI `Validate`                                                                       |
| `test_policy`                                               | met    | `CONTRIBUTING.md` "Test policy": new/changed functionality must ship with tests                                                                                    |
| `tests_are_added`                                           | met    | coverage gate fails any feature PR that drops below floor; recent PRs add tests                                                                                    |
| `tests_documented_added`                                    | met    | `CONTRIBUTING.md` documents the policy and the enforcing gate                                                                                                      |
| `crypto_published` / `crypto_call` / `crypto_floss`         | met    | standard-library + platform crypto only; no in-house crypto                                                                                                        |
| `crypto_keylength` / `crypto_working` / `crypto_weaknesses` | met    | TLS 1.2+ via Cloudflare; no weak/broken primitives                                                                                                                 |
| `no_leaked_credentials`                                     | met    | gitleaks on PR range + full-history; lefthook `gitleaks protect` pre-commit                                                                                        |
| `static_analysis`                                           | met    | `.github/workflows/security.yml` runs Semgrep, Snyk Code, Trivy, Grype on `main` + daily; gitleaks on PRs                                                          |
| `static_analysis_common_vulnerabilities`                    | met    | Semgrep rulesets + Snyk Code (SAST) cover common vuln classes                                                                                                      |
| `dynamic_analysis` (Passing: SHOULD)                        | met    | smoke + E2E suites (`pnpm smoke:local`, `smoke:prod:readonly`) exercise the running service                                                                        |

**Form-answer crib (the two formerly-open items):**

- `release_notes`: "Each CLI release is a GitHub Release whose notes are
  auto-generated from the merged PRs / commits since the previous `cli-v*` tag
  (`gh release create --generate-notes`), with a fixed footer documenting the
  attached SBOM, provenance attestation, grype scan, and checksums."
- `test_policy`: "CONTRIBUTING.md states that new or changed functionality must
  ship with tests; the `Validate` CI job enforces it via `pnpm test:coverage`
  against global coverage thresholds, so an under-tested change fails the gate."

## Silver — delta only

Silver-specific criteria beyond Passing. Engineering items are already met; the
remaining gaps are human/process, not code.

| Criterion                                                              | Status          | Note                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hardened_site` (key headers, nonpermissive)                           | met             | CSP (nonce + `strict-dynamic`), HSTS (`max-age=31536000; includeSubDomains; preload`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP — centralized in `packages/worker-runtime/src/security-headers.ts`, applied by `apps/web/src/security-headers.ts` and `apps/apex/src/security-headers.ts` |
| `test_statement_coverage80`                                            | met             | statement floor 88% (actual ~91%)                                                                                                                                                                                                                                                                                                                          |
| `test_branch_coverage70`                                               | met             | branch floor 82% (actual ~83%)                                                                                                                                                                                                                                                                                                                             |
| `test_continuous_integration`                                          | met             | `Validate` runs on every PR and push to `main`                                                                                                                                                                                                                                                                                                             |
| `crypto_weaknesses` / `crypto_pfs` / `crypto_certificate_verification` | met             | Cloudflare-terminated TLS; no custom TLS handling                                                                                                                                                                                                                                                                                                          |
| `dynamic_analysis` (Silver: MUST)                                      | met             | smoke + E2E suites, same as above                                                                                                                                                                                                                                                                                                                          |
| `installation_standard_variables` / `external_dependencies`            | met             | standard pnpm/Turborepo build; deps pinned via lockfile                                                                                                                                                                                                                                                                                                    |
| `signed_releases`                                                      | met             | CLI binaries carry SLSA build-provenance attestations; macOS codesigned + notarized; npm publish `--provenance` (OIDC)                                                                                                                                                                                                                                     |
| `version_tags_signed`                                                  | partial         | release tags exist; tag GPG-signing not enforced — low priority, provenance attestation already binds artifacts                                                                                                                                                                                                                                            |
| `code_review_standards`                                                | **gap (doc)**   | de-facto policy is CI-gate + CodeRabbit + resolved-threads-to-merge; not yet written as a standalone "review standards" doc. Closeable without a second human.                                                                                                                                                                                             |
| `two_person_review` (≥50% by non-author)                               | **gap (human)** | not met: solo maintainer. CodeRabbit is automated review, not a second human. Deferred until a co-maintainer exists.                                                                                                                                                                                                                                       |
| `bus_factor` ≥ 1 (Silver)                                              | met             | one active maintainer satisfies Silver; Gold needs ≥2                                                                                                                                                                                                                                                                                                      |

**Net Silver gap:** `two_person_review` (needs a second human) and a written
`code_review_standards` doc. Everything else is satisfied.

## Application steps (manual)

1. Sign in at <https://www.bestpractices.dev/> with the GitHub account and add
   the `zaks-io/agent-paste` project.
2. Fill the Passing form using the matrix + cribs above; each MUST → "Met" with
   the evidence link.
3. Confirm the green Passing tile, then add the badge to the README badge row
   (next to the Scorecard badge), replacing `<ID>` with the assigned project id:

   ```markdown
   [![OpenSSF Best Practices](https://www.bestpractices.dev/projects/<ID>/badge)](https://www.bestpractices.dev/projects/<ID>)
   ```

4. Optionally proceed through the Silver form, marking `two_person_review` and
   `code_review_standards` as the only unmet items, with the deferral note above.
5. Leave Gold unattempted until there are two unassociated significant
   contributors.

## Status

- [x] `release_notes` — generated GitHub Release notes (this change)
- [x] `test_policy` — repo-wide policy in `CONTRIBUTING.md` (this change)
- [x] Public visibility flip — done 2026-06-08 (AP-254); badge precondition cleared
- [ ] Register project + submit Passing form (manual)
- [ ] Add the README badge (snippet in step 3) once Passing is green
- [ ] (Optional, Silver) write `code_review_standards`; `two_person_review`
      deferred until a co-maintainer exists
