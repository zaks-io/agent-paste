import type { SqlExecutor } from "@agent-paste/db";
import { constantTimeEqual } from "@agent-paste/tokens/crypto";
import { resolveSqlExecutor } from "./db.js";
import { runAutoDeletionDiscovery } from "./discovery/auto-deletion.js";
import { runPurgeRecoveryDiscovery } from "./discovery/purge-recovery.js";
import type { Env } from "./env.js";
import { applyArtifactPurgeSideEffects } from "./lifecycle/purge-side-effects.js";

export type SmokeLifecycleCleanupResult = {
  expired_artifacts: number;
  enqueued: number;
  deleted_r2_objects: number;
};

type LocalMvpRevision = {
  bytes_purge_enqueued_at?: string | null;
};

type LocalMvpArtifact = {
  workspace_id: string;
  revision_id: string | null;
};

export type LocalMvpRepository = {
  runCleanup(input: {
    actor: { type: string; id: string };
    dryRun: boolean;
    batchSize?: number;
    now: string;
  }): Promise<{ expired_artifacts: number; expired_artifact_ids?: string[] }>;
  artifacts: Map<string, LocalMvpArtifact>;
  revisions: Map<string, LocalMvpRevision>;
};

export function isNonProductionEnv(env: Env): boolean {
  const value = env.AGENT_PASTE_ENV;
  return value !== undefined && value !== "production" && value !== "live";
}

export function authenticateSmokeHarness(request: Request, env: Env): boolean {
  const secret = env.SMOKE_HARNESS_SECRET;
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1] ?? null;
  return Boolean(secret && token && constantTimeEqual(token, secret));
}

export async function runSmokeLifecycleCleanup(env: Env): Promise<SmokeLifecycleCleanupResult> {
  if (env.LOCAL_MVP_REPOSITORY) {
    return runLocalMvpLifecycleCleanup(env.LOCAL_MVP_REPOSITORY, env);
  }

  const executor = resolveSqlExecutor(env);
  if (!executor) {
    throw new Error("database_unavailable");
  }

  const beforeDeleted = env.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0;
  const now = new Date().toISOString();
  const autoDeletion = await runAutoDeletionDiscovery(executor, env, now);
  const deletedR2Objects = (env.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0) - beforeDeleted;
  return {
    expired_artifacts: autoDeletion.discovered,
    enqueued: autoDeletion.enqueued,
    deleted_r2_objects: deletedR2Objects,
  };
}

async function runLocalMvpLifecycleCleanup(repo: LocalMvpRepository, env: Env): Promise<SmokeLifecycleCleanupResult> {
  const beforeDeleted = env.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0;
  const now = new Date().toISOString();
  const cleanup = await repo.runCleanup({
    actor: { type: "system", id: "auto_deletion" },
    dryRun: false,
    batchSize: 100,
    now,
  });
  const executor = createLocalRevisionExecutor(repo);
  let enqueued = 0;
  for (const artifactId of cleanup.expired_artifact_ids ?? []) {
    const artifact = repo.artifacts.get(artifactId);
    if (!artifact?.revision_id) {
      continue;
    }
    const sideEffects = await applyArtifactPurgeSideEffects(env, executor, {
      workspaceId: artifact.workspace_id,
      artifactId,
      revisionId: artifact.revision_id,
      reason: "deletion",
    });
    if (sideEffects.enqueued) {
      enqueued += 1;
    }
  }
  return {
    expired_artifacts: cleanup.expired_artifacts,
    enqueued,
    deleted_r2_objects: (env.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0) - beforeDeleted,
  };
}

function createLocalRevisionExecutor(repo: LocalMvpRepository): SqlExecutor {
  const query = async (sql: string, params?: readonly unknown[]) => {
    if (sql.includes("bytes_purge_enqueued_at") && params?.[1]) {
      const revision = repo.revisions.get(String(params[1]));
      if (revision) {
        revision.bytes_purge_enqueued_at = new Date().toISOString();
      }
    }
    return { rows: [] };
  };
  const executor: SqlExecutor = {
    query,
    transaction: async (run) => run(executor),
  };
  return executor;
}

export async function runSmokePurgeRecoveryForArtifact(
  env: Env,
  executor: SqlExecutor,
  artifactId: string,
): Promise<{ enqueued: boolean; deleted_r2_objects: number }> {
  const beforeDeleted = env.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0;
  const row = await executor.query<{ id: string; workspace_id: string; revision_id: string }>(
    `select id, workspace_id, revision_id
     from artifacts
     where id = $1
       and revision_id is not null
       and status in ('deleted', 'expired')`,
    [artifactId],
  );
  const artifact = row.rows[0];
  if (!artifact) {
    return { enqueued: false, deleted_r2_objects: 0 };
  }

  const sideEffects = await applyArtifactPurgeSideEffects(env, executor, {
    workspaceId: artifact.workspace_id,
    artifactId: artifact.id,
    revisionId: artifact.revision_id,
    reason: "deletion",
  });
  return {
    enqueued: sideEffects.enqueued,
    deleted_r2_objects: (env.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0) - beforeDeleted,
  };
}

export async function runSmokeArtifactPurgeRecovery(
  env: Env,
  artifactId: string,
): Promise<{ deleted_r2_objects: number }> {
  const beforeDeleted = env.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0;
  if (env.LOCAL_MVP_REPOSITORY) {
    const artifact = env.LOCAL_MVP_REPOSITORY.artifacts.get(artifactId);
    if (!artifact?.revision_id) {
      return { deleted_r2_objects: 0 };
    }
    const executor = createLocalRevisionExecutor(env.LOCAL_MVP_REPOSITORY);
    await applyArtifactPurgeSideEffects(env, executor, {
      workspaceId: artifact.workspace_id,
      artifactId,
      revisionId: artifact.revision_id,
      reason: "deletion",
    });
    return { deleted_r2_objects: (env.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0) - beforeDeleted };
  }

  const executor = resolveSqlExecutor(env);
  if (!executor) {
    throw new Error("database_unavailable");
  }
  const result = await runSmokePurgeRecoveryForArtifact(env, executor, artifactId);
  return { deleted_r2_objects: result.deleted_r2_objects };
}

export async function runFullPurgeRecovery(env: Env): Promise<void> {
  const executor = resolveSqlExecutor(env);
  if (!executor) {
    throw new Error("database_unavailable");
  }
  await runPurgeRecoveryDiscovery(executor, env);
}
