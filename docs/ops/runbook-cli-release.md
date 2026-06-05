# CLI Release Operator Runbook

How to cut a release of the `@zaks-io/agent-paste` CLI across all three
distribution channels (standalone binary, `npm i -g`, `npx`). Implements
[ADR 0080](../adr/0080-cli-version-baking-update-check-and-binary-self-upgrade.md);
the build/publish wiring lives in `.github/workflows/cli-release.yml` and
`.github/workflows/cli-advertise.yml`.

Scope:

- Bumping the CLI version, building signed/notarized binaries, publishing the npm
  package, and advertising the new version to the update-check endpoint.

Out of scope:

- API/Worker deploys (a CLI release writes **no** Worker code — only KV data).
- Installer (`apps/apex`) changes and the `install.sh`/`install.ps1` flow.

Related docs:

- [ADR 0080](../adr/0080-cli-version-baking-update-check-and-binary-self-upgrade.md) — version baking, update check, binary self-upgrade.
- [CLI auto-update plan](./cli-auto-update-plan.md) — the four implementation phases.
- [CLI README](../../apps/cli/README.md) — `version` / `upgrade` commands, `AGENT_PASTE_NO_UPDATE_CHECK`.

## The one source of truth

**`apps/cli/package.json`'s `version`** drives everything:

- the version **baked into** each binary (`--define:__AGENT_PASTE_CLI_VERSION__`),
- the **npm** package version,
- the `latest`/`min_supported` advertised in the `CLI_RELEASE` **KV** value,
- the GitHub **release tag** (`cli-v<version>`), derived by CI — never typed by hand.

Because the tag is derived from `package.json`, the channels cannot advertise
mismatched versions. You bump one number; CI does the reconciliation.

## Release steps

### 1. Bump the version (normal PR)

Bump `apps/cli/package.json` `version` to the new semver in a regular pull
request and merge it to `main` through the usual gate. Nothing else needs the
version — leave the tag, the binary, and KV alone; they all derive from this.

### 2. Build the draft (CLI Release workflow)

Dispatch the **CLI Release** workflow (`workflow_dispatch`, no inputs) against
`main`:

```sh
gh workflow run cli-release.yml --ref main
```

It cross-compiles the four binaries on native per-OS runners
(`agent-paste-{linux-x64,linux-arm64,darwin-arm64,windows-x64.exe}`), bakes the
`package.json` version into each, codesigns + notarizes the macOS binary,
attaches a CycloneDX SBOM + grype report + build-provenance attestations, and
creates (or updates) a **draft** GitHub release tagged `cli-v<version>` with a
`SHA256SUMS` manifest.

The tag is read from `package.json` inside the job; if `version` is not clean
semver the job fails before creating the release.

### 3. Review and publish the draft

Open the draft release. Confirm the four assets + `SHA256SUMS` are present and
the tag matches the version you bumped. Optionally verify a binary's provenance:

```sh
gh attestation verify <binary> --repo zaks-io/agent-paste
```

When satisfied, **publish** the draft (the GitHub Release UI, or
`gh release edit cli-v<version> --draft=false`). This human publish gate is
deliberate (ADR 0080 §6): nothing reaches npm or KV until you publish.

### 4. Automatic: npm publish + KV advertise

Publishing the release fires **CLI Advertise Release**
(`cli-advertise.yml`, on `release: published`, gated on the `cli-v*` tag prefix).
It:

1. re-asserts the release tag equals `cli-v<package.json version>`,
2. `npm publish --provenance` of `@zaks-io/agent-paste` (OIDC trusted publishing,
   no stored token; skipped idempotently if that version is already on npm),
3. writes the `cli-release` key in the `CLI_RELEASE` KV namespace for **both**
   `preview` and `production` (`{ latest, min_supported }`, both set to the new
   version), resolving the namespace id from `apps/api/wrangler.jsonc`.

No `api` redeploy. Within the update-check cache window (max-age 300s + a short
per-isolate memo), stale CLIs on the binary channel start seeing
`Run: agent-paste upgrade` and npm-global users see the `npm i -g …@latest` hint.

## Verifying a release landed

| Channel    | Check                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------ |
| GitHub     | `gh release view cli-v<version>` is published (not draft) with 4 assets + `SHA256SUMS`.    |
| npm        | `npm view @zaks-io/agent-paste version` returns the new version.                           |
| Update API | `curl -sS <api-origin>/v1/public/cli-version` returns `{ latest, min_supported }` updated. |
| Binary     | On a binary install, `agent-paste upgrade` downloads + verifies + self-replaces.           |

`<api-origin>` is the per-environment API base (preview or production). The
endpoint is public and unauthenticated; CF edge-caches it for ~5 minutes, so a
freshly advertised version can take a few minutes to appear.

## One-time prerequisites (already done)

- **npm trusted publisher** configured on npmjs.com (org `zaks-io`, repo
  `agent-paste`, workflow `cli-advertise.yml`); a `0.0.0` placeholder is
  published so the package exists. No stored npm token.
- **Apple signing** secrets (`APPLE_CERTIFICATE`, `APPLE_API_KEY*`, etc.) for the
  macOS codesign + notarize step.
- **`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`** repo secrets (shared with
  the deploy workflow) scoped to the KV-write step only.

## Failure modes

| Symptom                                             | Likely cause                                               | Action                                                            |
| --------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| CLI Release fails on "Invalid package.json version" | `version` is not clean semver                              | Fix `apps/cli/package.json`, merge, re-dispatch.                  |
| Advertise fails on tag/version mismatch             | Release tagged off a SHA whose `package.json` differs      | Ensure the bump merged before dispatching; re-cut from `main`.    |
| npm publish skipped ("already published")           | Re-published an existing release (event re-fires on edits) | Expected; the KV write still runs and is idempotent.              |
| `agent-paste upgrade` reports a checksum mismatch   | Corrupted download or asset/`SHA256SUMS` drift             | Re-run; if persistent, re-cut the release (do **not** hand-edit). |
| Update check never shows the new version            | Edge cache not yet expired, or KV write failed             | Wait ~5 min; check the Advertise run's KV step logs.              |

## Verification boundary

- Safe for CI and agents: dispatching CLI Release, inspecting drafts, unit tests.
- Requires a human: **publishing** the draft release (triggers npm + KV).
- Never commit npm tokens, Apple signing material, or Cloudflare tokens to the
  repo, Linear, or PR comments.
