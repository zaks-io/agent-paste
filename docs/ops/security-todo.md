# Security workflow follow-ups (ADR 0076)

Deferred work tied to the dedicated `.github/workflows/security.yml` security
workflow ([ADR 0076](../adr/0076-public-open-source-security-posture-and-badges.md)).
The private-phase gate is implemented; the repo is now public (2026-06-08) with
CodeQL, secret scanning, Dependabot alerts, and OpenSSF Scorecard live. The
remaining items below include scanner refinements and Snyk triage.
The slow scanner bundle lives in `pnpm security:attest` and runs on `main`, the
daily `Security` workflow, and the CLI release workflow. Production deploy does
not run or wait for this whole-repository bundle; see
`.github/workflows/deploy-production.yml`. PR CI intentionally
stays fast and does not run the full bundle.

## pnpm audit report contract (AP-413)

Use the repository-pinned pnpm 10.34.5. It returns an `advisories` object from
the supported npm audit service. The policy evaluates the post-ignore advisory
list, blocks unallowed moderate, high, and critical findings, and rejects
malformed reports or missing/unknown severities. A retired-endpoint error object
remains a failure, never an empty successful audit.

`scripts/fixtures/pnpm-audit-moderate.json` records the actual supported report
shape captured on 2026-10-06 for GHSA-r4xh-jqrq-34v2. Its regression test proves
that the policy rejects a real moderate advisory. The complete scanner bundle
still needs the executables configured by the hosted Security workflow.

## Dependency remediation (AP-457)

The 2026-10-06 daily attestation found six advisories across five dependencies.
The root overrides and lockfile now select these upstream fixes:

| Dependency    | Fixed version | Advisory                                                                                                                                           |
| ------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| seroval       | 1.6.8         | [GHSA-p6vx-979v-rg4c](https://github.com/advisories/GHSA-p6vx-979v-rg4c), [GHSA-jp82-f5mq-hwhp](https://github.com/advisories/GHSA-jp82-f5mq-hwhp) |
| shell-quote   | 1.11.0        | [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv)                                                                           |
| smol-toml     | 1.9.0         | [GHSA-r4xh-jqrq-34v2](https://github.com/advisories/GHSA-r4xh-jqrq-34v2)                                                                           |
| source-map-js | 1.2.2         | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)                                                                           |
| sharp         | 0.35.5        | [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)                                                                           |

Direct payload regressions showed that Seroval 1.6.3 still assimilated callable
thenables and accepted array-like TypedArray sources. Version 1.6.8 rejects both
payloads, so the override uses that release rather than the advisory minimum.

Seroval runs in the web dashboard's TanStack serialization path. Shell-quote
belongs to the eval runner's Daytona SDK. The remaining dependencies support
repository checks and builds. These fixes do not change scanner thresholds or
the verified braces mitigation below. Only `source-map-js@1.2.2`, the sole
fixed release, has a version-scoped exception to pnpm's seven-day release delay.
[`docs/development.md`](../development.md) keeps that delay for every other
package and version.

## Zod request array bound (AP-457, AP-484)

Zod 4.6.6 is the first release that fixes
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Its `capSize` wrapper enforces each declared array maximum before element
validation, which is the behavior `patches/zod@4.4.3.patch` used to add for
[SNYK-JS-ZOD-20510278](https://security.snyk.io/vuln/SNYK-JS-ZOD-20510278).
The root override `zod@>=4.0.0 <5.0.0` = `4.6.6` selects that release for Zod
4 consumers and does not apply to Zod 3. The catalog pin is the same release.
Valid and within-limit invalid requests retain their behavior; oversized arrays
return one `too_big` error and skip refinements. Arrays without a maximum
remain outside this bound. Zod 4.6.6 `sizeCaps` reads only a leading run of
size checks, so the request-bound walker does the same. A `.max()` after
`.refine()` is not a pre-element cap.

The Lighthouse chain's Zod 3.25.76 copy has a separate verified disposition;
see [Lighthouse Zod 3 disposition](#lighthouse-zod-3-disposition-ap-485).

The local 4.4.3 patch and the Zod 4 Snyk waiver are removed because the upstream
parser covers those inputs. `scripts/lib/zod-patch.mjs` still fails closed: it
checks the override, rejects any Zod patch registration, checks both locks,
pins the 4.6.6 parser digests, checks enumerated consumer versions, and runs
the early-rejection behavior. The request-schema tests still require every
array maximum to be at most 100.

The AP-481 TanStack Start update moved its build tooling from Zod 3 to Zod 4,
so those six exact paths now resolve the same fixed Zod 4.6.6 as the runtime
consumers, and their build-only Snyk dispositions for SNYK-JS-ZOD-20510278 are
removed. Those config parsers consume inline Vite options and repository
`tsr.config.json`, not request data. `zod-build-policy.mjs` still pins every
versioned dependency hop and the reviewed config parser bytes, so a TanStack
upgrade fails verification until it is reviewed.

## Lighthouse Zod 3 disposition (AP-485)

Lighthouse 13.4.1, a root devDependency for the CI accessibility checks, still
resolves `zod@3.25.76` through `puppeteer-core@25.9.0` and
`chromium-bidi@17.0.2` (`zod@^3.24.1`). No Zod 3 release fixes
GHSA-mrhx-c7xc-m3w5. `puppeteer-core@25.13.0` is the first release inside
Lighthouse's range whose chromium-bidi depends on Zod 4, but
`chromium-bidi@157.0.8090-0` and every later release checked through 2026-10-31
lack the trusted-publisher provenance that `17.0.2` has. `trustPolicy:
no-downgrade` rejects that update, and forcing Zod 4 onto chromium-bidi 17 is
not a compatible repair. Excluding chromium-bidi from the trust policy would
install a package without provenance in CI jobs that hold preview secrets, a
larger risk than this advisory.

This Zod copy does not load in Node. Only chromium-bidi's `protocol-parser`,
which its in-browser BiDi tab mapper uses, imports it. Lighthouse calls
`puppeteer.connect({ browserURL })` over CDP. puppeteer-core loads chromium-bidi
only through a dynamic import in its WebDriver BiDi branch, and that bridge
passes no parser, so chromium-bidi falls back to `BidiNoOpParser`.

Before any scanner disposition, `scripts/lib/zod-lighthouse-policy.mjs` checks:

- every installed hop matches the reviewed version;
- both the repository and installed pnpm locks, parsed as YAML with aliases
  resolved to package identities, have exactly one consumer per hop: the root
  `devDependencies` entry named `lighthouse` for `lighthouse@13.4.1`, then the
  reviewed parent for `puppeteer-core@25.9.0`, `chromium-bidi@17.0.2`, and
  `zod@3.25.76`. Every importer and snapshot dependency and optional-dependency
  edge counts, and a second alias from the same dependent counts as another
  consumer, because pnpm audit deduplicates visited packages and skips local
  links, so it can report only the reviewed path when a second consumer exists;
- the locks use only shapes the consumer check understands: every importer is
  a workspace project that `pnpm ls --recursive` discovers, every `link:`
  resolves to one of those projects outside `node_modules`, every peer or patch
  suffix is well formed, every package resolves from the registry by integrity
  alone, and importer, dependency, package, and snapshot entries carry only the
  fields these locks use today. pnpm prefers an entry's own `id` or `version`
  over its key, so any other field fails verification, as does any file,
  tarball, git, or directory source, until this disposition is reviewed for it;
- a child process that loads Lighthouse and the puppeteer-core BiDi bridge
  resolves chromium-bidi modules, which proves it observes that path, and no
  module from the Zod 3 package.

Failed verification fails the attestation and enables no exception. The pnpm
audit, Trivy, and Grype policies then allow only GHSA-mrhx-c7xc-m3w5 and its CVE
alias, `zod@3.25.76`, the `.>lighthouse>puppeteer-core>chromium-bidi>zod` path,
and the root `pnpm-lock.yaml` target. Every location a scanner reports for the
artifact must be an allowed target, so a match that also names another lockfile
blocks. Raw reports are preserved. The weekly Snyk
scan runs without `--dev`, so it does not report this root devDependency path.

Any Lighthouse or puppeteer-core upgrade fails verification until it is
reviewed. Remove the verifier, disposition, and tests together once a
chromium-bidi release with provenance that depends on Zod 4 clears the
seven-day age gate, or a Lighthouse release drops the Zod 3 chain.

## Dependency remediation (AP-484)

The 2026-10-29 `pnpm audit` found 24 distinct advisory IDs at the policy's
blocking severities (moderate, high, and critical) on `main`. Its summary count of
30 also includes four low-severity findings. Except for the Lighthouse Zod 3 path
(AP-485) and
the TanStack Start advisory owned by AP-481, every blocking advisory has a fixed
release past the seven-day age gate. No age exception is added. The remaining
low-severity [GHSA-866g-f22w-33x8](https://github.com/advisories/GHSA-866g-f22w-33x8)
in the eval runner's `@ai-sdk/provider-utils@4.0.30` stays open; its fix requires
a much newer `ai` release.

| Dependency       | Fixed version | Advisory                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| undici           | 7.30.1        | [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c), [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685), [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472), [GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx), [GHSA-4w7w-5xrc-9h26](https://github.com/advisories/GHSA-4w7w-5xrc-9h26), [GHSA-55wc-3pg8-jfw6](https://github.com/advisories/GHSA-55wc-3pg8-jfw6), [GHSA-9fm3-97px-rjf6](https://github.com/advisories/GHSA-9fm3-97px-rjf6), [GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm) |
| fast-uri         | 3.1.9         | [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr)                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| seroval          | 1.6.12        | [GHSA-9wx9-5pv9-3349](https://github.com/advisories/GHSA-9wx9-5pv9-3349), [GHSA-f86p-h4j2-7qgj](https://github.com/advisories/GHSA-f86p-h4j2-7qgj)                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| hono             | 4.13.13       | [GHSA-5r4p-p66f-jhc7](https://github.com/advisories/GHSA-5r4p-p66f-jhc7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| vite             | 7.3.7         | [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm), [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv), [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw), [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22)                                                                                                                                                                                                                                                                                                         |
| @vitest/mocker   | 4.1.12        | [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8), [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp)                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| follow-redirects | 1.16.1        | [GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c), [GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8)                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| qs               | 6.16.1        | [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Seroval runs in the web dashboard's TanStack serialization path. Its root
override moves from the AP-457 release to `1.6.12`, the newest eligible patch,
and `scripts/security-dependencies.test.mjs` keeps a regression for each new
advisory. The Hono Workers do not use `serveStatic`, the affected API. Their
manifests now require `^4.13.13`. `typed-rest-client` pins `qs@6.15.1`, so its
root override selects the fix. Axios's `follow-redirects@^1.16.0` range and
the Vite and Vitest manifest ranges select the rest in the lockfile without new
overrides. The other packages support evals, mutation testing, builds, and
tests.

## Braces depth patch (AP-456)

`braces@3.0.3` has no upstream fix for
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
(`CVE-2026-93687`) as of 2026-10-05. The
[upstream report](https://github.com/micromatch/braces/issues/70) describes the
recursive AST walkers exhausting the stack on deeply nested strings.
`patches/braces@3.0.3.patch` rejects a combined brace/parenthesis parse depth
above 100 before an AST reaches those walkers. Normal glob patterns and depth
100 remain supported. Directly supplied, hand-crafted ASTs are outside this
mitigation; current micromatch consumers pass strings.

The patch covers root jscpd and the eval runner's Daytona SDK. The AP-481
TanStack Start update moved its build tooling to chokidar 5, which no longer
depends on braces, so those paths are gone. Before any scanner disposition, `scripts/lib/braces-patch.mjs`
checks the registered patch and its digest, both repository and installed pnpm
locks, every resolved consumer's parser digest/version, rejection through parse,
compile, expand, and stringify, and an ordinary expansion. Missing or modified
mitigation fails the attestation and enables no exception. Unreferenced pnpm
store copies are recorded; an active unpatched reference still fails.

Version-only scanners continue to report 3.0.3. The existing dependency policy
allows only those two advisory IDs, package/version, enumerated verified
dependency paths, and the root `pnpm-lock.yaml` target. It preserves raw reports
and records the verified mitigation as an attestation step. New IDs, versions,
paths, targets, or failed verification block normally. Remove the patch,
verifier/disposition, and corresponding regression tests together after an
upstream release fixes this advisory and the dependency graph is updated.

The Snyk runner applies the same verified patch disposition to
`SNYK-JS-BRACES-19963945`. It matches each workspace manifest and complete
versioned dependency path, preserves raw JSON, and requires reports for every
workspace. Scanner failures, missing workspaces, and unmatched findings fail
closed. No `.snyk` ignore rules apply.

The local Cloudflare harnesses use HTTP fixtures on `127.0.0.1`. Semgrep's
`react-insecure-request` rule flags those literals even though it exempts
`localhost`. Their requests now use `local-cloudflare-request.mjs`, which
rejects remote hosts and URL credentials and prevents automatic redirects.
Manual sign-in redirect inspection remains supported. Real HTTP regression
tests exercise that boundary; no scanner exclusions or suppressions apply.

## Private phase (do now / when convenient)

- [x] **Remove the esbuild GHSA ignores and bump esbuild to >=0.28.1**. Done
      2026-06-28: the root pnpm override pins `esbuild` to `0.28.1`, and the
      expired ignores were removed from `pnpm-workspace.yaml`, `.trivyignore`,
      and `.grype.yaml`.

- [x] Confirm the org-wide `SNYK_TOKEN` reaches this repo's Actions — proven on
      PR #217: Snyk Open Source tested 24 projects (clean) and Snyk Code ran.
- [x] Pass the public GitHub remote URL to Snyk Open Source scans. Done
      2026-07-04 for AP-403: `snyk test --all-projects` sets
      `--remote-repo-url` to this public GitHub repo. Live verification on
      2026-08-30 showed that URL attribution alone does not make the CLI tests
      public: Snyk still classified each workspace manifest as private and
      exhausted the 200-test monthly quota. The complete 29-manifest test now
      runs weekly, which fits the routine quota while the repo attestation
      continues on every `main` push and every day. Monitoring is disabled until
      the repo has a verified public Snyk project because a second 29-manifest
      CLI scan each week would exceed the private-test allowance.
- [x] Patch the eval runner image's upstream shrinkwrapped `brace-expansion`
      copy to `5.0.7`. Done 2026-07-04 for AP-403: the Dockerfile updates the
      nested `@earendil-works/pi-coding-agent` install after `npm ci` and asserts
      the installed version, because the package's own `npm-shrinkwrap.json`
      otherwise forces `5.0.6`.
- [x] Promote the local scanner bundle to a blocking attestation path:
      `gitleaks`, `pnpm audit`, Checkov OpenAPI, Trivy with dev deps, Syft SBOM,
      Grype, and Semgrep all write reports under `artifacts/security/` and fail
      the job on the configured threshold. Daily/main `Security` and
      CLI release call the same command so release evidence and
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
- [ ] Link a public Snyk project, then restore a weekly
      `snyk monitor --all-projects` snapshot of `main` without consuming
      private-test quota. Verify public classification before enabling the
      monitor command.
- [ ] Tune scanner noise only if warranted: add `.semgrep.yml` / `.trivyignore` /
      `.snyk` ignore files instead of leaving findings as advisory log spam. Start
      empty; add narrowly-scoped allowlists per confirmed false positive.
- [ ] Decide whether to promote `Repo security attestation` to a required
      ruleset check for `main`. The attestation job is blocking inside its
      workflow today, but repository rulesets still decide whether a failed
      `Security` workflow blocks merging. Reconsider Snyk as a required check
      only after its public-project classification is fixed; it currently runs
      weekly to stay within the private-test quota.
- [ ] Re-verify the pinned non-`actions/*` action tags are current before each
      release cycle: `aquasecurity/trivy-action@v0.36.0`, `anchore/sbom-action@v0`,
      `anchore/scan-action@v7`, and the `semgrep/semgrep` container image.
      `anchore/scan-action@v7` is also used by the CLI release (AP-154 Phase 1),
      which additionally pins `@cyclonedx/cyclonedx-esbuild@1` — re-verify all
      surfaces together.

- [ ] **Stop minting a "Default" API key at first sign-in** (AP-444, filed
      2026-09-14).
      `ensureWebMember` in
      `packages/db/src/repository/workflows/web-member-workflow.ts` creates a
      never-expiring key with the member's full scopes the moment WorkOS
      returns a new user, before they have done anything. Production on
      2026-09-14 held one drive-by account whose key has never been used.
      The CLI does not depend on it: `agent-paste login` mints its own key
      through `web.apiKeys.create` (`apps/cli/src/login.ts`). Keep CLI key
      creation on login and explicit key creation on `/keys`; browser sign-in
      must not mint a key. Confirm nothing consumes the bootstrap
      `secret` in `webAuthResponse`, then remove the mint and its
      `api_key.created` event. Revoke the existing unused bootstrap key.
      Done when browser sign-in creates zero API keys, and first-time CLI
      `login` through `web.apiKeys.create` provisions the Workspace and member
      without a Default key, creates exactly one CLI key, and preserves that
      key's `api_key.created` event.

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
      link behavior. Done 2026-06-07: the `source-repository` component adds
      the link to the footer + About + How it works, and
      `apps/apex/src/index.test.ts` asserts the public GitHub URL. The repo is
      now public (2026-06-08), so the source link resolves.
- [x] Stand up a status page or public incident/update channel. Decision
      recorded 2026-06-07: the minimum public incident intake channel is the
      `support@agent-paste.sh` mailbox, which routes through email into Linear. A
      separate hosted status page remains optional until the account/tooling
      stack is ready.
- [x] Enable **OpenSSF Scorecard** with published results. Done 2026-06-08:
      `.github/workflows/scorecard.yml` runs on `main` push, weekly cron, and
      `branch_protection_rule`, publishing to the public OpenSSF API so the
      README badge resolves. All external Actions are SHA-pinned and the repo
      `sha_pinning_required` policy is on.
- [x] Enable GitHub CodeQL / code scanning, GitHub secret scanning, and
      Dependabot alerts. Done with the public flip (2026-06-08): the repo is
      public, CodeQL runs via GitHub default setup (SARIF in code scanning),
      secret scanning + push protection are on, and Dependabot alerts are on.
      Dependabot version **updates** stay off by design — dependency bumps come
      through the scheduled review agent, not Dependabot PRs.
- [ ] Swap the advisory SARIF **artifact** uploads (Trivy, Semgrep) for
      `github/codeql-action/upload-sarif`, and add `security-events: write` to the
      relevant job's `permissions`. Keep the top-level default at `contents: read`.
- [x] Gate Semgrep ERROR findings and Trivy/Grype medium-or-higher findings in
      the shared repo attestation. Snyk remains separate while its entitlement
      and quota issues are unresolved. The standalone CLI bundle's Grype scan
      is also blocking in `cli-release.yml`.
- [x] Configure npm **trusted publishing (OIDC)** + provenance for
      `@zaks-io/agent-paste` from a protected release workflow (operator-confirmed
      2026-06-07; replaces long-lived npm tokens).
- [ ] Add only externally-verifiable badges: CI, the security workflow, the
      OpenSSF Best Practices **Passing** badge, and the Snyk **npm package** badge
      once the package is public. No badge may imply a private scan result is
      publicly verifiable. The OpenSSF Scorecard badge already ships in
      `README.md`. The Best Practices target tier and the
      criterion-by-criterion self-assessment (Passing met; Silver delta; Gold
      out of scope) live in
      [`openssf-best-practices.md`](./openssf-best-practices.md); its README badge
      is added once Passing is green (snippet in that doc).
