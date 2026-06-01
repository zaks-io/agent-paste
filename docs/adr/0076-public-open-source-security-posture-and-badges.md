# Public Open-Source Security Posture and Badges

Status: Accepted.

agent-paste will build its security checks while the repository is still
private, but public trust signals are only published after the repository is
public and carries a real open-source license. Private security scan results
must not be represented as publicly verifiable badges.

## Context

agent-paste is currently private, but [ADR 0073](./0073-open-core-billing-plan-tiered-usage-policy-disabled-by-default.md)
records the open-core direction: the source becomes public under a permissive
license, and the hosted service is the monetized product.

The CLI is intended to be distributed as the public npm package
`@zaks-io/agent-paste`, but it is still marked `UNLICENSED` and protected by a
publish guard until the licensing decision lands. The repository already has a
full-history `gitleaks` gate in CI, and the local toolchain includes scanners
that can run without buying a private-repo security product.

Most useful public trust signals become free only after the repository is
public. GitHub CodeQL/code scanning, GitHub secret scanning, Dependabot,
OpenSSF Scorecard, OpenSSF Best Practices, Snyk package badges, and npm
provenance are strongest when consumers can verify the source, license, scan
configuration, and release workflow themselves.

## Decision

- **Private phase builds the gate, not the marketing.** Add a dedicated
  `security.yml` workflow that runs the free checks we can operate while the
  repository is private: full-history `gitleaks`, Snyk Open Source on the
  workspace manifests, Snyk Code within the free quota, and optionally Semgrep,
  Trivy filesystem scanning, Syft SBOM generation, and Grype dependency
  scanning.
- **Snyk monitors private state, but does not create a public claim.** A free
  Snyk account may be used for private CI and `main` monitoring. Any Snyk badge
  shown to users must be tied to a public package or public project that users
  can inspect.
- **Badges must be externally verifiable.** While the repo is private, use
  workflow status badges only for internal collaborators. Do not publish a
  README, website, or npm badge that implies the private source scan result is
  publicly verifiable.
- **Public phase turns on public security features.** After the repository is
  public and licensed, enable GitHub CodeQL/code scanning, GitHub secret
  scanning, Dependabot alerts/updates, OpenSSF Scorecard with published
  results, and the OpenSSF Best Practices badge if the license and project
  posture satisfy the FLOSS requirements.
- **The public package can carry a package-level Snyk badge.** Once
  `@zaks-io/agent-paste` is published publicly, the package README may include
  the Snyk npm package badge. That badge is a package/dependency signal, not a
  substitute for repository code scanning.
- **Release trust uses OIDC publishing, not long-lived npm tokens.** Once the
  source repository is public, npm releases should run from a protected GitHub
  Actions release workflow using npm trusted publishing and provenance. Until
  the repository is public, provenance is not treated as a user-facing trust
  signal.
- **Do not pay early for badge optics.** Paid security products are reserved
  for needs that exceed the open-source/free posture: private-repo enterprise
  scanning, compliance reports, audit logs, custom policy management,
  organization-wide governance, managed runners, external audits, or pentests.

## Public readiness checklist

Before adding public security badges or publishing the CLI:

- Add a root `LICENSE` file and change package metadata away from
  `UNLICENSED`.
- Add `SECURITY.md` with supported versions, a vulnerability reporting path,
  and an explicit statement about whether a bounty exists.
- Ensure the dedicated security workflow is green on `main`.
- Enable CodeQL/code scanning, secret scanning, Dependabot, and OpenSSF
  Scorecard on the public repository.
- Configure npm trusted publishing for `@zaks-io/agent-paste` from the
  protected release workflow.
- Add only badges backed by public, inspectable signals: CI, security workflow,
  Scorecard, OpenSSF Best Practices when applicable, and Snyk npm package
  status once the package exists.

## Done

The private phase is done when PRs and `main` run a dedicated security workflow,
Snyk monitors `main`, and no public-facing copy claims a private scan result.

The public phase is done when the repository is public and licensed, public
GitHub/OpenSSF/Snyk/npm security signals are enabled, the CLI is published from
a protected OIDC release workflow, and all displayed badges link to verifiable
public evidence.

## Considered Options

- **Pay now for private-repo badges.** Rejected. The project is expected to
  become public, and the useful public trust signals become free at that point.
  Paying early would mostly buy private-repo visibility and reporting, not a
  stronger public claim.
- **Use a custom badge backed by private scan results.** Rejected. It would be
  easy to make, but consumers could not verify the underlying source, workflow,
  or scan result while the repo is private.
- **Wait until open-source release to add any security automation.** Rejected.
  The private phase can still catch secrets, vulnerable dependencies, risky
  patterns, and release-process drift before the source becomes public.

## Consequences

- The project gets practical private security gates now without taking on paid
  vendor commitments just to obtain badges.
- Public trust signals wait until they are meaningful: users can inspect the
  source, license, workflows, Scorecard results, package metadata, and release
  provenance.
- The open-source release has a concrete checklist instead of a last-minute
  scramble over licensing, security policy, scanner setup, and npm release
  posture.
- Scorecard findings may require follow-up hardening, especially around GitHub
  Actions permissions and action pinning. Those fixes should be prioritized for
  the release and security workflows before broad repo-wide churn.
