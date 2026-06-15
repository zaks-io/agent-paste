# Agent experience: happy-path friction and one prod bug

Source of truth for follow-ups found by running the cold agent happy path
("Please generate a report and post it to agent-paste.sh") against the live
MCP server. Owner: Isaac. Snapshot date: 2026-06-13.

The walkthrough used the connected `agent-paste` MCP server (authed as
`isaac@zaks.io`, scopes write/read/share) plus the globally installed
`agent-paste` CLI (v0.1.2). Findings are ordered worst-first.

> **Status (2026-06-13):** P0 is FIXED in PR1 (`ArtifactSummary.revision_id`
> nullable + loud-log the swallowed Zod error). P1 (publish returns no link) and
> the CLI/MCP divergence are being fixed by the publish-unification work — see
> the plan and PR2/PR3. The descriptions below are kept as the original findings.
>
> **Update (ADR 0086):** publish is now content-only and private and always
> returns one openable link, `private_url` (the `/v/<artifactId>` clean viewer),
> so "publish returns no link" no longer happens and there is no `share` flag to
> mis-set. Unlisted no-login sharing is the explicit `set_visibility`
> (MCP) / `agent-paste set-visibility <artifact-id> unlisted` (CLI) verb, which replaced `create_share_link`. References to
> `create_share_link`/`share`/`access_link_url` below are the original (now
> superseded) framing.

> **Update (2026-06-15 production pass):** CLI ergonomics are much better on
> `@zaks-io/agent-paste@0.1.7`; the core authenticated CLI loop now returns
> `artifact_id`, `private_url`, `agent_view_url`, and stable update commands.
> New issues found:
>
> - **P0 runtime:** production `agent-paste-jobs-production` fails Bundle
>   generation and safety scans with Cloudflare `Illegal invocation` because R2
>   methods were called with a detached `this`. Evidence in Axiom:
>   `queue.bundle_generate.failed`, `queue.safety_scan.failed`, and
>   `queue.bundle_generate.final_failure` for smoke revisions including
>   `rev_B90MHRGD0R7VJ14TVMYCA6J4Y0`. Fixed in the AP-139 follow-up branch by
>   binding R2 `get`/`put` calls in jobs.
> - **P1 CLI ergonomics:** `publish --artifact-id` without `--title` renamed the
>   Artifact to the local temp directory basename. Fixed in the AP-139 follow-up
>   branch by preserving the existing Agent View title unless `--title` is
>   explicit.
> - **MCP gap:** unauthenticated MCP metadata and 401 behavior verified, but
>   authenticated MCP tools still need a connected WorkOS/OAuth host session for
>   `whoami`, publish/read/revise/edit, visibility, link listing, and cleanup.

> **Update (2026-06-15 post-deploy pass):** production deploy run `27579713918`
> succeeded for `49c531ec` with release security attestation, migration, Worker
> deploy, and read-only production smoke green. The jobs R2 fix is live: fresh
> production smoke revision bundles for `art_DZSTY830HVQ64H0C0C7Q3MHFYF`
> reached `ready`, including `rev_KGJGR62R1DNMW78A7W3JH9REJ4`,
> `rev_G5NHTHPCGGWA7PTWY97XBYPYH4`, and
> `rev_G13QE0HKHVTR0VGKVMBJ6V10DS`.
>
> Remaining gaps:
>
> - **CLI release gap:** npm `@zaks-io/agent-paste@latest` is still `0.1.7`
>   from `74a839cb`, so external agents using `npx @latest` still reproduce the
>   title drift: `publish --artifact-id` renamed the smoke Artifact to `site`.
>   The CLI package version must be bumped and released before this fix is live
>   for npm/npx users.
> - **Docs gap:** public `/docs/cli.md` omitted the real `pull` and `edit`
>   commands even though the CLI help and README document them. Patch pending in
>   the CLI release follow-up.
> - **MCP gap:** authenticated MCP tool calls still need a real connected
>   WorkOS/OAuth host session.

## P0 — `list_artifacts` 500s for any workspace that has a draft artifact

`mcp__agent-paste__list_artifacts` returns `internal_error` (HTTP 500) against
production for my workspace, reproducibly. Confirmed in Axiom (`cloudflare`
dataset, service `agent-paste-mcp-production`, trace
`a54812ffc2f07b2972bf932c60390e9d`): the MCP worker fans out two upstream calls,
`GET /v1/mcp/whoami` (200) and `GET /v1/artifacts` (200), then the root `POST /`
returns 500 with **no logged exception**.

Root cause is a contract-vs-data mismatch, not an upstream failure:

- The API list route serializes whatever the repo returns with no outbound
  response validation (`apps/api/src/responses.ts` `executeRepositoryRoute`
  just `respondJson(await run())`), so it happily returns 200.
- The MCP worker validates that 200 body against `McpListArtifactsOutput`
  (= `ArtifactListResponse`) in `parseForwardResult`
  (`apps/mcp/src/tools.ts:354`). On a `safeParse` miss it maps to
  `internal_error` **and discards the Zod error** — that is why Axiom shows a
  500 with zero diagnostics.
- `ArtifactSummary.revision_id` is a non-nullable `RevisionId`
  (`packages/contracts/src/artifacts.ts:7`), but the `artifacts.revision_id`
  column is **nullable** (confirmed via Neon schema for project
  `still-forest-91029005`), and the codebase treats `revision_id: string | null`
  as a real state: `upload-session-lifecycle.ts:193` sets it to `null` while an
  upload/draft is in flight, and helpers gate on `!artifact.revision_id`
  (`artifacts-pin.ts:15`, `artifact-workflow-helpers.ts:20`).
- `toArtifactSummary` (`packages/db/src/transforms.ts:25`) passes
  `artifact.revision_id` straight through. One draft row (null `revision_id`)
  in the page makes the whole `list_artifacts` call fail.

Fixes (pick the contract direction deliberately, then close the gaps):

- [ ] Decide the contract: either (a) `ArtifactSummary.revision_id` becomes
      `RevisionId.nullable()` to admit drafts, or (b) `listMemberArtifacts`
      excludes artifacts with no published revision (its filter is already
      `status === "active" && !deleted_at`; add `&& revision_id != null`, or
      reuse the `requirePublishedRevision` notion). (a) is more honest if agents
      should see drafts; (b) keeps the summary "published only." Spec the choice
      in `docs/specs/` and update `ArtifactStatus`/data-model notes to match.
- [ ] Stop swallowing the validation error in `parseForwardResult`: log the Zod
      issue (at least the failing path + tool name) before mapping to
      `internal_error`. A 500 with no breadcrumb is undebuggable in prod; this
      one took a full-trace Axiom dig to localize.
- [ ] Add the missing test. `member-mcp-operations.test.ts` only lists a
      `memberWithPublishedArtifact` fixture, and repo-level tests return raw
      objects that never round-trip through `ArtifactSummary.safeParse`. Add a
      test that lists a workspace containing a draft (null-`revision_id`)
      artifact **through the MCP output schema** so the contract mismatch is
      caught at the seam it actually breaks.

## P1 — Publish gives an agent nothing to hand back to the user

"Post it to agent-paste.sh" reads as "give me a link," but
`publish_artifact`/`add_revision` by design omit the artifact id, agent view
URL, and any link, and only return `title` + `expires_at` + `upload_stats`. An
agent that follows the tool description literally (don't set `share` unless
explicitly asked) ends up with **no URL and no id** — it published successfully
and has nothing to report. The documented recovery path (`list_artifacts` to
recover the id, then `create_share_link`) is exactly the call that P0 breaks, so
the agent is fully stuck.

This is the core happy-path ambiguity. Options:

- [ ] Treat "post it to agent-paste.sh" as implied intent to share. Either let
      `publish_artifact` return the agent view URL (a private, authed URL the
      agent can cite) even without `share:true`, or sharpen the tool description
      so the model knows that a user asking to "post"/"publish to the site"
      counts as "explicitly asks for a shareable link." Right now the safe
      reading produces a dead end.
- [ ] Always return the artifact id from `publish_artifact`/`add_revision`. The
      no-id design forces a `list_artifacts` round trip for any follow-up
      (revise, share, read), which is both slower and currently broken. The id
      is not sensitive; withholding it mainly hurts the agent.

## P2 — The returned link host is `app.agent-paste.sh`, not `agent-paste.sh`

With `share:true`, the access link comes back as
`https://app.agent-paste.sh/al/...`. The user said "agent-paste.sh." Not a bug,
but worth a one-line note in the MCP/CLI docs so agents don't second-guess the
host or try to rewrite it to the apex domain.

## P3 — Agents cannot self-verify a share link

A share link is end-to-end encrypted: the decryption key lives in the URL
`#fragment`, which never reaches the server. A server-side fetch (what an agent
has) only ever sees "Resolving…", so an agent **cannot confirm its own link
rendered**. This is correct by design, but agents will try and report a false
failure. Document it: "the link works in a browser; you cannot verify it with a
plain HTTP fetch."

## P4 — `whoami` not-signed-in semantics are agent-hostile

`agent-paste whoami` when signed out prints to **stdout** (not stderr) and exits
**0**. An agent gating on exit code sees success and proceeds to publish, which
then fails on auth. `--json` returns `{"authenticated": false}` (good), but the
plain/exit-code contract should make "not signed in" detectable without parsing
prose. Consider a non-zero exit (or at least routing the notice to stderr) for
the signed-out case. Cross-check against the CLI three-mode output contract in
`docs/specs/cli.md` before changing — exit codes there are deliberate.

## Not bugs (verified, recording so the next agent does not re-chase)

- Worktree `pnpm cli:dev` fails with `Cannot find package 'esbuild'` — the
  worktree has no deps installed; this is the documented `pnpm setup:worktree`
  step, not a CLI defect. The global `agent-paste` binary works fine.
- The `app.` host and the "Resolving…" fetch result are both expected (P2, P3).
