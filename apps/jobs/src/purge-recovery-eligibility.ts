import { type SqlExecutor, withSqlQuerySource } from "@agent-paste/db";

export type PurgeRecoveryEligibilityReason =
  | "eligible"
  | "row_missing"
  | "not_deleted_or_expired"
  | "missing_revision_id";

export type PurgeRecoveryArtifactRow = {
  id: string;
  workspace_id: string;
  revision_id: string;
};

export type PurgeRecoveryArtifactInspection = {
  eligibility: PurgeRecoveryEligibilityReason;
  artifact_found: boolean;
  status: string | null;
  deleted_at: string | null;
  revision_id: string | null;
  workspace_id: string | null;
  artifact?: PurgeRecoveryArtifactRow;
};

type ArtifactLookupRow = {
  id: string;
  workspace_id: string;
  revision_id: string | null;
  status: string;
  deleted_at: string | null;
};

export async function inspectPurgeRecoveryArtifact(
  executor: SqlExecutor,
  artifactId: string,
): Promise<PurgeRecoveryArtifactInspection> {
  const row = await withSource("inspectPurgeRecoveryArtifact", () =>
    executor.query<ArtifactLookupRow>(
      `select id, workspace_id, revision_id, status, deleted_at
     from artifacts
     where id = $1`,
      [artifactId],
    ),
  );
  const artifact = row.rows[0];
  if (!artifact) {
    return {
      eligibility: "row_missing",
      artifact_found: false,
      status: null,
      deleted_at: null,
      revision_id: null,
      workspace_id: null,
    };
  }
  if (!artifact.revision_id) {
    return {
      eligibility: "missing_revision_id",
      artifact_found: false,
      status: artifact.status,
      deleted_at: artifact.deleted_at,
      revision_id: null,
      workspace_id: artifact.workspace_id,
    };
  }
  if (artifact.status !== "deleted" && artifact.status !== "expired") {
    return {
      eligibility: "not_deleted_or_expired",
      artifact_found: false,
      status: artifact.status,
      deleted_at: artifact.deleted_at,
      revision_id: artifact.revision_id,
      workspace_id: artifact.workspace_id,
    };
  }
  return {
    eligibility: "eligible",
    artifact_found: true,
    status: artifact.status,
    deleted_at: artifact.deleted_at,
    revision_id: artifact.revision_id,
    workspace_id: artifact.workspace_id,
    artifact: {
      id: artifact.id,
      workspace_id: artifact.workspace_id,
      revision_id: artifact.revision_id,
    },
  };
}

function withSource<T>(functionName: string, run: () => T): T {
  return withSqlQuerySource(
    {
      filepath: "apps/jobs/src/purge-recovery-eligibility.ts",
      functionName,
      namespace: "apps.jobs.src.purge-recovery-eligibility",
    },
    run,
  );
}
