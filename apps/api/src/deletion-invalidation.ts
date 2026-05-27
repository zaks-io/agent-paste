import { peekIdempotentReplay } from "@agent-paste/commands";
import {
  type AdminActor,
  type ArtifactBytePurgeHooks,
  type ArtifactInvalidationEnv,
  applyArtifactPurgeSideEffects,
  createHyperdriveExecutor,
  type HyperdriveBinding,
  type Repository,
  rlsExecutor,
  type SqlExecutor,
  writeArtifactDenylist,
} from "@agent-paste/db";

const ADMIN_ARTIFACT_DELETE_OPERATION = "admin.artifact.delete";

export type DeletionInvalidationEnv = ArtifactInvalidationEnv & {
  DB?: Repository | HyperdriveBinding;
  SYNC_BYTE_PURGE_DELETED_OBJECTS?: number;
  LOCAL_MVP_REPOSITORY?: {
    revisions: Map<string, { bytes_purge_enqueued_at?: string | null }>;
  };
};

export type PostCommitArtifactDeletionInput = {
  actor: AdminActor;
  idempotencyKey: string;
  workspaceId: string;
  artifactId: string;
  revisionId: string | null;
};

export type PostCommitArtifactDeletionResult = {
  /** True when idempotency replay skipped post-commit invalidation. */
  replaySkipped: boolean;
  denylistWritten: boolean;
  enqueued: boolean;
  deleted_r2_objects: number;
};

export function isHyperdriveDb(value: DeletionInvalidationEnv["DB"]): value is HyperdriveBinding {
  return typeof value === "object" && value !== null && "connectionString" in value;
}

export function resolveDeletionInvalidationExecutor(env: DeletionInvalidationEnv): SqlExecutor | undefined {
  if (env.LOCAL_MVP_REPOSITORY) {
    return createLocalMvpRevisionExecutor(env.LOCAL_MVP_REPOSITORY);
  }
  if (isHyperdriveDb(env.DB)) {
    return createHyperdriveExecutor(env.DB);
  }
  return undefined;
}

export async function peekAdminArtifactDeleteReplay(
  executor: SqlExecutor,
  input: { actor: AdminActor; workspaceId: string; idempotencyKey: string },
): Promise<boolean> {
  const replay = await peekIdempotentReplay<unknown>({
    executor: rlsExecutor(executor, { kind: "workspace", workspaceId: input.workspaceId }),
    actor: { type: input.actor.type, id: input.actor.id, workspaceId: input.workspaceId },
    operation: ADMIN_ARTIFACT_DELETE_OPERATION,
    idempotencyKey: input.idempotencyKey,
  });
  return replay !== null;
}

/**
 * Post-commit artifact deletion invalidation (ADR 0049): denylist first, byte-purge enqueue second.
 * Skipped on idempotency replay so side effects are not duplicated.
 */
export async function runPostCommitArtifactDeletionInvalidation(
  env: DeletionInvalidationEnv,
  input: PostCommitArtifactDeletionInput,
  options: {
    isReplay: boolean;
    hooks?: ArtifactBytePurgeHooks;
  },
): Promise<PostCommitArtifactDeletionResult> {
  if (options.isReplay) {
    return {
      replaySkipped: true,
      denylistWritten: false,
      enqueued: false,
      deleted_r2_objects: 0,
    };
  }

  if (!input.revisionId) {
    const denylistWritten = await writeArtifactDenylist(env, input.artifactId);
    return {
      replaySkipped: false,
      denylistWritten,
      enqueued: false,
      deleted_r2_objects: 0,
    };
  }

  const executor = resolveDeletionInvalidationExecutor(env);
  if (!executor) {
    const denylistWritten = await writeArtifactDenylist(env, input.artifactId);
    return {
      replaySkipped: false,
      denylistWritten,
      enqueued: false,
      deleted_r2_objects: 0,
    };
  }

  const beforeDeleted = env.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0;
  const sideEffects = await applyArtifactPurgeSideEffects(
    env,
    rlsExecutor(executor, { kind: "workspace", workspaceId: input.workspaceId }),
    {
      workspaceId: input.workspaceId,
      artifactId: input.artifactId,
      revisionId: input.revisionId,
      reason: "deletion",
    },
    options.hooks,
  );
  const deleted_r2_objects = (env.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0) - beforeDeleted;
  return {
    replaySkipped: false,
    denylistWritten: sideEffects.denylistWritten,
    enqueued: sideEffects.enqueued,
    deleted_r2_objects,
  };
}

function createLocalMvpRevisionExecutor(repo: {
  revisions: Map<string, { bytes_purge_enqueued_at?: string | null }>;
}): SqlExecutor {
  const executor: SqlExecutor = {
    query: (async (sql, params) => {
      if (sql.includes("bytes_purge_enqueued_at") && params?.[1]) {
        const revisionId = String(params[1]);
        const revision = repo.revisions.get(revisionId);
        if (revision) {
          revision.bytes_purge_enqueued_at = new Date().toISOString();
          return { rows: [{ id: revisionId }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    }) as SqlExecutor["query"],
    transaction: async (run) => run(executor),
  };
  return executor;
}
