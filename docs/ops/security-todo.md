# Security workflow follow-ups (ADR 0076)

Deferred work tied to the dedicated `.github/workflows/security.yml` security
workflow ([ADR 0076](../adr/0076-public-open-source-security-posture-and-badges.md)).
The private-phase gate is implemented; these are the remaining items, split into
what can land while the repo is private and what waits for the public flip.

## Private phase (do now / when convenient)

- [x] Confirm the org-wide `SNYK_TOKEN` reaches this repo's Actions — proven on
      PR #217: Snyk Open Source tested 24 projects (clean) and Snyk Code ran.
- [ ] Enable the **Snyk Code (SAST) entitlement** on the Snyk org
      (`isaac-…`). On PR #217 `snyk code test` ran the analysis but the report
      call returned **403 Forbidden (SNYK-CLI-0000)**. Snyk Code is wired as
      **advisory** (`|| true` + SARIF artifact) until the entitlement is on; flip
      it back to gating only after the entitlement works and AP-160 triage is done.
- [ ] Triage the initial Snyk Code HIGH findings (19 on PR #217) — see **AP-160**.
      Mostly `scripts/*.mjs` "hardcoded non-cryptographic secret" likely-FPs plus a
      few app-code XSS/SSRF worth a real look. Add `.snyk` ignores for confirmed FPs.
- [ ] Link a Snyk project so `snyk monitor --all-projects` (main-only step) posts
      `main` state to the Snyk dashboard. Verify after the first push to `main`.
- [ ] Tune scanner noise only if warranted: add `.semgrep.yml` / `.trivyignore` /
      `.snyk` ignore files instead of leaving findings as advisory log spam. Start
      empty; add narrowly-scoped allowlists per confirmed false positive.
- [ ] Decide whether to promote the secret-scan checks — `Secret scan` (ci.yml,
      PR incremental) and `Secret scan (full history)` (security.yml) — and the
      Snyk `Dependency scan (SCA)` job to **required** ruleset checks. The two
      secret-scan checks are deliberately named distinctly so a required-check rule
      can target one unambiguously. Today only `Validate` is required, so the
      security jobs are visible but non-blocking. Promote in a follow-up PR once the
      first few `Security` runs are stable, so a flaky first run can't lock `main`.
- [ ] Re-verify the pinned non-`actions/*` action tags are current before each
      release cycle: `aquasecurity/trivy-action@v0.36.0`, `anchore/sbom-action@v0`,
      `anchore/scan-action@v7`, and the `semgrep/semgrep` container image.

## Public phase (after the repo is public + licensed)

Per ADR 0076, public trust signals become meaningful only once the source,
license, workflows, and scan config are inspectable.

- [ ] Enable GitHub CodeQL / code scanning, GitHub secret scanning, Dependabot
      alerts + updates, and OpenSSF Scorecard (with published results).
- [ ] Swap the advisory SARIF **artifact** uploads (Trivy, Semgrep) for
      `github/codeql-action/upload-sarif`, and add `security-events: write` to the
      relevant job's `permissions`. Keep the top-level default at `contents: read`.
- [ ] Promote Snyk Code / Semgrep / Trivy / Grype from advisory to **gating** once
      their entitlement (Snyk Code) and false-positive surface are characterized.
- [ ] Configure npm **trusted publishing (OIDC)** + provenance for
      `@zaks-io/agent-paste` from a protected release workflow (replaces long-lived
      npm tokens).
- [ ] Add only externally-verifiable badges: CI, the security workflow, Scorecard,
      OpenSSF Best Practices (if FLOSS requirements are met), and the Snyk **npm
      package** badge once the package is public. No badge may imply a private scan
      result is publicly verifiable.
