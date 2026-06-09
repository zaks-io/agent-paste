# Security workflow follow-ups (ADR 0076)

Deferred work tied to the dedicated `.github/workflows/security.yml` security
workflow ([ADR 0076](../adr/0076-public-open-source-security-posture-and-badges.md)).
The private-phase gate is implemented; the repo is now public (2026-06-08) with
CodeQL, secret scanning, Dependabot alerts, and OpenSSF Scorecard live. The
remaining items below are advisory-only scanner refinements and Snyk triage.
The slow scanner bundle lives in `pnpm security:attest` and runs on `main`, the
daily `Security` workflow, and release/deploy workflows. PR CI intentionally
stays fast and does not run the full bundle.

## Private phase (do now / when convenient)

- [x] Confirm the org-wide `SNYK_TOKEN` reaches this repo's Actions — proven on
      PR #217: Snyk Open Source tested 24 projects (clean) and Snyk Code ran.
- [x] Promote the local scanner bundle to a blocking attestation path:
      `gitleaks`, `pnpm audit`, Checkov OpenAPI, Trivy with dev deps, Syft SBOM,
      Grype, and Semgrep all write reports under `artifacts/security/` and fail
      the job on the configured threshold. Daily/main `Security`, production
      deploy, and CLI release all call the same command so release evidence and
      daily drift checks cannot diverge. Semgrep records all findings but blocks
      only on `ERROR` severity until the existing INFO/WARNING noise is triaged.
- [ ] Enable the **Snyk Code (SAST) entitlement** on the Snyk org
      (`isaac-…`). On PR #217 `snyk code test` ran the analysis but the report
      call returned **403 Forbidden (SNYK-CLI-0000)**. Snyk Code is not part of
      `pnpm security:attest`; keep it separate until the entitlement works and
      AP-160 triage is done.
- [ ] Triage the initial Snyk Code HIGH findings (19 on PR #217) — see **AP-160**.
      Mostly `scripts/*.mjs` "hardcoded non-cryptographic secret" likely-FPs plus a
      few app-code XSS/SSRF worth a real look. Add `.snyk` ignores for confirmed FPs.
- [ ] Link a Snyk project so `snyk monitor --all-projects` (main-only step) posts
      `main` state to the Snyk dashboard. Verify after the first push to `main`.
- [ ] Tune scanner noise only if warranted: add `.semgrep.yml` / `.trivyignore` /
      `.snyk` ignore files instead of leaving findings as advisory log spam. Start
      empty; add narrowly-scoped allowlists per confirmed false positive.
- [ ] Decide whether to promote `Repo security attestation` and Snyk
      `Dependency scan (Snyk SCA)` to required ruleset checks for `main`. The
      attestation job is blocking inside its workflow today, but repository
      rulesets still decide whether a failed `Security` workflow blocks merging.
- [ ] Re-verify the pinned non-`actions/*` action tags are current before each
      release cycle: `aquasecurity/trivy-action@v0.36.0`, `anchore/sbom-action@v0`,
      `anchore/scan-action@v7`, and the `semgrep/semgrep` container image.
      `anchore/scan-action@v7` is also used by the CLI release (AP-154 Phase 1),
      which additionally pins `@cyclonedx/cyclonedx-esbuild@1` — re-verify all
      surfaces together.

## CLI Release supply-chain (AP-154)

- [x] **Phase 1 (capture, non-blocking)** — `.github/workflows/cli-release.yml`
      attaches a per-release CycloneDX SBOM (`agent-paste-cli.sbom.cdx.json`)
      generated from the `bun build --metafile` bundler graph via
      `@cyclonedx/cyclonedx-esbuild`, so it lists **exactly** what is compiled into
      the binary (the bundled workspace packages + the external closure `zod` +
      `@asteasolutions/zod-to-openapi`) — not the whole monorepo and not a hollow
      manifest scan. Also attaches a grype scan report (`agent-paste-cli.grype.json`)
      and scanner/DB versions (`scan-metadata.json`), and emits a per-binary
      `actions/attest-build-provenance` attestation. Scan is advisory
      (`fail-build: false`). The metafile route was chosen because the CLI is a
      bundled app: its workspace deps are (correctly) `devDependencies` and are
      inlined from TS source, so a lockfile/manifest scan can't see the real
      closure. `pnpm sbom --prod --filter` would be the native answer but ships
      after pnpm 10.19.0 (our pinned version).
- [ ] **Phase 2 (gate, blocking)** — fail the release on HIGH+ in the CLI closure
      with a defined severity policy; capture the scan result as an
      `actions/attest` predicate attestation (not just a CI log).
- [ ] **Phase 3 (daily re-scan)** — daily workflow re-scans each supported
      release's captured SBOM against the current vuln DB and alerts (issue /
      Linear) on new CVEs. Non-blocking, no rebuild. Optional `cosign` for a
      uniform Linux/Windows signature (macOS already notarized).

## Public repo security posture

Per ADR 0076, public trust signals matter because the source, license,
workflows, and scan config are inspectable.

Aggregator for the public-repo security toggles plus the source-link follow-up
below is [AP-254](https://linear.app/zaks-io/issue/AP-254),
filed off an external credibility review.

- [x] Ship the apex GitHub source link and keep tests covering the public source
      link behavior. Done 2026-06-07 (`83cde8c`): the `source-repository`
      component adds the link to the footer + About + How it works, and
      `apps/apex/src/index.test.ts` asserts the public GitHub URL. The repo is
      now public (2026-06-08), so the source link resolves.
- [x] Stand up a status page or public incident/update channel. Decision
      recorded 2026-06-07: the minimum public incident intake channel is the
      `support@agentpaste` mailbox, which routes through email into Linear. A
      separate hosted status page remains optional until the account/tooling
      stack is ready.
- [x] Enable **OpenSSF Scorecard** with published results. Done 2026-06-08
      (`3d64126` workflow, `2de2280` badge): `.github/workflows/scorecard.yml`
      runs on `main` push, weekly cron, and `branch_protection_rule`, publishing
      to the public OpenSSF API so the README badge resolves. All external
      Actions are SHA-pinned (`33474e4`, #436) and the repo `sha_pinning_required`
      policy is on.
- [x] Enable GitHub CodeQL / code scanning, GitHub secret scanning, and
      Dependabot alerts. Done with the public flip (2026-06-08): the repo is
      public, CodeQL runs via GitHub default setup (SARIF in code scanning),
      secret scanning + push protection are on, and Dependabot alerts are on.
      Dependabot version **updates** stay off by design — dependency bumps come
      through the scheduled review agent, not Dependabot PRs.
- [ ] Swap the advisory SARIF **artifact** uploads (Trivy, Semgrep) for
      `github/codeql-action/upload-sarif`, and add `security-events: write` to the
      relevant job's `permissions`. Keep the top-level default at `contents: read`.
- [ ] Promote Snyk Code / Semgrep / Trivy / Grype from advisory to **gating** once
      their entitlement (Snyk Code) and false-positive surface are characterized.
- [x] Configure npm **trusted publishing (OIDC)** + provenance for
      `@zaks-io/agent-paste` from a protected release workflow (operator-confirmed
      2026-06-07; replaces long-lived npm tokens).
- [ ] Add only externally-verifiable badges: CI, the security workflow, the
      OpenSSF Best Practices **Passing** badge, and the Snyk **npm package** badge
      once the package is public. No badge may imply a private scan result is
      publicly verifiable. The OpenSSF Scorecard badge already ships in `README.md`
      (`2de2280`). The Best Practices target tier and the criterion-by-criterion
      self-assessment (Passing met; Silver delta; Gold out of scope) live in
      [`openssf-best-practices.md`](./openssf-best-practices.md); its README badge
      is added once Passing is green (snippet in that doc).
