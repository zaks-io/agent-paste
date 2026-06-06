import type { LocalState } from "./local-state.js";
import type { RunScope } from "./ports.js";

// Thrown by the local backend when a workspace-scoped write targets another tenant's
// row. This is a test-surface bug detector, not a domain error: it is intentionally a
// plain Error (never a RepositoryError) so the error envelope cannot catch it and
// downgrade it to a 4xx/5xx — a cross-tenant write must surface as a failing test. The
// Postgres backend has no equivalent; in production RLS handles isolation. See ADR 0083.
export class CrossTenantWriteError extends Error {
  readonly name = "CrossTenantWriteError";

  constructor(collection: string, rowWorkspaceId: string | null, scopeWorkspaceId: string) {
    super(
      `local backend: cross-tenant write to ${collection} ` +
        `(row workspace ${rowWorkspaceId ?? "none"} != run scope workspace ${scopeWorkspaceId})`,
    );
  }
}

// How a row in a given collection is tested against a Run Scope. Returning null
// means "never in a workspace scope" (platform-only tables); otherwise the string
// is the row's owning workspace id (null inside it -> belongs to no workspace).
type ScopeKey<V> = ((row: V) => string | null) | "platform-only";

// The local analogue of a Postgres RLS policy: a view over one backing Map that,
// under a workspace Run Scope, exposes only rows owned by that workspace. Reads of
// foreign rows return nothing (RLS-faithful); a write whose row belongs to another
// workspace throws (a cross-tenant write is never legitimate, so the local backend
// surfaces it loudly instead of silently emulating RLS). See ADR 0083.
//
// Only get/set/values are overridden — those are the only Map operations the local
// entity adapters use. The base Map storage is intentionally empty (every read consults
// the backing Map), so any other read method (has/keys/entries/iteration/size/forEach)
// would return nothing; rather than emulate them, they throw so a new caller fails loud
// instead of silently seeing an empty collection.
class ScopedMap<V> extends Map<string, V> {
  constructor(
    private readonly collection: string,
    private readonly backing: Map<string, V>,
    private readonly workspaceId: string,
    private readonly scopeKey: ScopeKey<V>,
  ) {
    super();
  }

  private rowWorkspaceId(row: V): string | null {
    return this.scopeKey === "platform-only" ? null : this.scopeKey(row);
  }

  private inScope(row: V): boolean {
    return this.scopeKey !== "platform-only" && this.scopeKey(row) === this.workspaceId;
  }

  override get(key: string): V | undefined {
    const row = this.backing.get(key);
    if (row === undefined || !this.inScope(row)) {
      return undefined;
    }
    return row;
  }

  override set(key: string, row: V): this {
    if (!this.inScope(row)) {
      throw new CrossTenantWriteError(this.collection, this.rowWorkspaceId(row), this.workspaceId);
    }
    this.backing.set(key, row);
    return this;
  }

  override *values(): MapIterator<V> {
    for (const row of this.backing.values()) {
      if (this.inScope(row)) {
        yield row;
      }
    }
  }

  override get size(): number {
    return this.unsupported("size");
  }

  override has(): boolean {
    return this.unsupported("has");
  }

  override keys(): MapIterator<string> {
    return this.unsupported("keys");
  }

  override entries(): MapIterator<[string, V]> {
    return this.unsupported("entries");
  }

  override forEach(): void {
    this.unsupported("forEach");
  }

  override [Symbol.iterator](): MapIterator<[string, V]> {
    return this.unsupported("[Symbol.iterator]");
  }

  private unsupported(method: string): never {
    throw new Error(
      `ScopedMap.${method} is not implemented; local adapters read via get/values only (${this.collection})`,
    );
  }
}

// The row type stored in a given LocalState collection.
type RowOf<K extends keyof LocalState> = LocalState[K] extends Map<string, infer V> ? V : never;

const byWorkspaceId = (row: { workspace_id: string | null }) => row.workspace_id;

// Per-collection scope keys, mirroring the RLS policies in migration 0003 (and 0004/
// 0008/0011/0015/0018). workspaces is scoped by its own id; platform_lockdowns has no
// tenant policy (platform scope only); operation_events.workspace_id is nullable, and a
// null-workspace row fails `workspace_id = app.workspace_id` so it is invisible under a
// workspace scope, exactly as it is in Postgres.
const SCOPE_KEYS: { [K in keyof LocalState]: ScopeKey<RowOf<K>> } = {
  workspaces: (row) => row.id,
  workspaceMembers: byWorkspaceId,
  apiKeys: byWorkspaceId,
  artifacts: byWorkspaceId,
  revisions: byWorkspaceId,
  artifactFiles: byWorkspaceId,
  uploadSessions: byWorkspaceId,
  uploadSessionFiles: byWorkspaceId,
  operationEvents: byWorkspaceId,
  platformLockdowns: "platform-only",
  accessLinks: byWorkspaceId,
  safetyWarnings: byWorkspaceId,
  claimTokens: byWorkspaceId,
};

function scopeOne<K extends keyof LocalState>(state: LocalState, name: K, workspaceId: string): LocalState[K] {
  return new ScopedMap<RowOf<K>>(
    name,
    state[name] as Map<string, RowOf<K>>,
    workspaceId,
    SCOPE_KEYS[name],
  ) as LocalState[K];
}

// Translate a Run Scope into a Scoped View over in-memory state. Platform scope returns
// the raw state (unfiltered, mirroring the RLS platform role); workspace scope returns a
// state whose every Map is a ScopedMap bound to that workspace. The raw LocalState Maps
// are never replaced, so tests and the local MVP server keep seeding/inspecting directly.
export function scopedLocalState(state: LocalState, scope: RunScope): LocalState {
  if (scope.kind === "platform") {
    return state;
  }
  const workspaceId = scope.workspaceId;
  const scoped = {} as LocalState;
  for (const name of Object.keys(state) as Array<keyof LocalState>) {
    scoped[name] = scopeOne(state, name, workspaceId) as never;
  }
  return scoped;
}
