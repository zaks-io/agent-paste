# Local Repository Backend Enforces Run Scope As A Bug Detector

[ADR 0070](./0070-repository-core-ports-and-adapters.md) gives the repository one backend-agnostic `RepositoryCore` over two adapters: the Postgres backend (RLS-scoped transactions) and the local in-memory backend. Tenant isolation in production is enforced by Postgres RLS ([ADR 0044](./0044-workspace-isolation-via-postgres-rls.md)): a workspace-scoped transaction runs as `app_role` (`NOBYPASSRLS`) with `SET LOCAL app.workspace_id`, so a query that forgets its `workspace_id` predicate is still safe — RLS makes foreign rows invisible at the transaction boundary.

The local backend did not enforce the **Run Scope** at all. `LocalUnitOfWork.read(scope, run)` received the scope and discarded it (`read(_scope, run)`); the local entity adapters read and wrote the raw in-memory Maps by id. Because nearly the entire repository test suite runs against the local backend (fast, no Postgres), the one invariant the whole security model rests on — _no operation returns or writes a row outside the run's workspace_ — was untested by the surface most tests use. A workflow that read cross-tenant under a workspace **Run Scope**, or threaded the wrong scope, would pass every local test and only fail on a real-Postgres `.postgres.test.ts` run, or in production.

This ADR records that the local backend now enforces the **Run Scope** through a **Scoped View**, and — this is the load-bearing part — that it does so as a **bug detector that deliberately diverges from RLS's silent-invisibility**, not as a faithful RLS emulator.

## Decision

The local backend translates a **Run Scope** into a **Scoped View** over in-memory state, the local analogue of the database role an RLS transaction runs as:

- **Platform Run Scope** (`{ kind: "platform" }`) — the view is the raw Maps, unfiltered. Mirrors the RLS platform role used for the narrow legitimate cross-tenant operations.
- **Workspace Run Scope** (`{ kind: "workspace", workspaceId: W }`) — the view exposes only rows whose `workspace_id === W`, with this split:
  - **Foreign read returns nothing** (RLS-faithful). A `findById` / `list*` that targets another tenant's row sees an empty view, exactly as RLS would. The misbehaving workflow still fails its test downstream ("expected an Artifact, got null"), but the view itself does not throw — because under workspace scope a null read is also the legitimate fail-closed-as-not-found result, and there is no way to distinguish "forgot the scope" from "legitimately absent."
  - **Foreign insert throws** (loud, self-labeling). An `insert` writes a full row through `set()`, carrying its own explicit `workspace_id`. When that id does not match the **Run Scope** the view throws, because writing a _new_ row into the wrong tenant is never legitimate and is unambiguous (there is no "absent vs forgot-scope" ambiguity as there is on reads). It surfaces as a failing test with a cross-tenant message rather than a silent no-op.
  - **Foreign mutation no-ops** (RLS-faithful). Every mutation other than `insert` is get-then-mutate: it `get()`s the row and assigns fields in place. For a foreign row the scoped `get()` returns nothing, so the mutation affects zero rows — exactly as an RLS-scoped `UPDATE` would. This holds whether the mutation is keyed by id alone (`markDeleted`, `revoke`, `setPinnedAt`) or also takes a workspace argument it re-checks (`updateTitle(artifactId, workspaceId, …)`, `markRetained({ …, workspaceId })`); the workspace-bearing ones simply return `false`. The throw is reserved for the one path that calls `set()` with a row of its own — `insert`.

The divergence from RLS is intentional: production RLS is uniformly _silent_ (foreign rows are invisible; a forbidden write silently affects zero rows). The local backend trades that fidelity for **catching the mistake** on the write path, because the local backend's job is to be a test oracle, not a production runtime. This is the A1 choice from the design review: loud over faithful, on the writes where loudness is unambiguous.

## Why no carve-outs are needed

The enforcement is purely additive — it can only catch mistakes, never break a legitimate operation — because the workflow layer already segregates **Run Scope** correctly at every call site:

- **Credential discovery precedes workspace context and already runs under the platform Run Scope.** `apiKeys.findByPublicId` (in `verifyApiKey`) and `claimTokens.findByPublicId` resolve a credential to learn _which_ workspace the caller is in; they run under `PLATFORM_SCOPE`, where the **Scoped View** is unfiltered.
- **The one intentional cross-tenant write already runs under the platform Run Scope.** The claim flow's `artifacts.reparentWorkspace(fromWorkspaceId, toWorkspaceId, …)` moves **Ephemeral Workspace** content into the member's **Workspace** ([ADR 0075](./0075-agent-first-ephemeral-publish-and-write-gated-monetization.md)). The whole `ephemeral.workspace.claim` command runs under `PLATFORM_SCOPE`, so the cross-tenant write is expected and not flagged.

Because the legitimate cross-scope operations declare `PLATFORM_SCOPE` explicitly, the workspace-scoped path contains only operations that _should_ stay in one tenant. The **Scoped View** enforces exactly that, with no per-operation exceptions.

## Considered Options

- **Enforce per local entity adapter (the explicit-predicate check).** Make each adapter assert it carries a workspace filter. Rejected: that tests a _stricter_ contract than production (RLS does not require every query to carry a predicate), so it would flag safe-under-RLS code as a violation; and it recreates the "forgot the guard" failure mode inside the test double — a new adapter method could omit the check.
- **Enforce at the unit-of-work seam, throw on every foreign row including reads (strict A1).** Maximally loud: every cross-tenant access self-labels. Rejected for reads because it is a landmine for the legitimate workspace-scoped read that correctly expects null (fail-closed-as-not-found is the documented resolve semantics, [ADR 0036](./0036-error-envelope-and-generic-404-boundary.md)); it would force platform-scoping reads that are correctly workspace-scoped today.
- **Enforce at the unit-of-work seam via a Scoped View; silent-empty on reads and get-then-mutate writes, throw on a foreign `insert` (chosen).** One enforcement point, no per-method knowledge of which argument is the target id, RLS-faithful where RLS is silent, loud on the one path — `insert` calling `set()` with its own row — where a write provably crosses the boundary.
- **Make the local backend a faithful, uniformly-silent RLS emulator.** Rejected: it would make the local backend behave like production but catch _nothing_ on the write path — the cross-tenant insert that this ADR makes loud would become a silent no-op, and the test surface would be no better than before. Recorded here so this is not "fixed" later by removing the throw in the name of fidelity.

## Consequences

- **The local backend is now a real second adapter for the isolation invariant, not a scope-blind double.** Every existing local-backend test through the `Repository` interface implicitly guards tenant isolation on the write path.
- **A cross-tenant write fails in local CI**, not only on a real-Postgres `.postgres.test.ts` run or in production.
- **`RunScope` and the local Scoped View gain domain vocabulary.** [`CONTEXT.md`](../../CONTEXT.md) adds **Run Scope** and **Scoped View** under Runtime primitives so future docs and reviews share one name for the seam.
- **This does not change production behavior.** Postgres RLS ([ADR 0044](./0044-workspace-isolation-via-postgres-rls.md)) is unchanged; the Postgres `UnitOfWork` already enforced the **Run Scope** through `rlsExecutor`. This ADR only closes the gap in the local backend's enforcement.
- **The silent-empty read remains the documented behavior.** A test that wants to assert a cross-tenant read is blocked asserts the downstream not-found, not a thrown cross-tenant error.

## What this ADR is not

- Not a change to the production isolation model. RLS is still the production boundary; this is about the test-surface backend.
- Not a per-query predicate-discipline rule. The invariant guarded is "no operation returns or writes a row outside the **Run Scope**," enforced at the seam, not "every query carries a `workspace_id` predicate."
- Not a relaxation of the platform **Run Scope**. The narrow cross-tenant operations that legitimately need it ([ADR 0044](./0044-workspace-isolation-via-postgres-rls.md) runtime reads, the claim reparent, `jobs` sweeps) keep declaring it explicitly.
