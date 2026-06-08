import { PGlite } from "@electric-sql/pglite";
import { createId } from "../id.js";
import { PostgresRepository } from "../postgres/repository.js";
import type { ApiActor } from "../types.js";
import { applyMigrations, executorForPglite, pgliteConnection, platformExecutor, workspaceExecutor } from "./pglite.js";

const DEFAULT_MEMBER_SCOPES = ["publish", "read", "admin"] as const;

const adminActor = { type: "admin" as const, id: "route-boundary-test" };
// Routes such as getAgentView enforce the artifact's expiry against the real
// wall clock (Date.now(), which can't be injected). A frozen past date makes the
// seeded artifact expire once fixtureNow + the artifact TTL passes, so the suite
// would start failing on a specific calendar day. Anchor to the real clock so the
// expiry window is always open.
const fixtureNow = new Date().toISOString();

export type WorkspaceActorSeed = {
  id: string;
  apiActor: ApiActor;
  apiKeySecret: string;
  memberActor: ApiActor;
  workosUserId: string;
};

export type WorkspaceBoundarySeed = WorkspaceActorSeed & {
  published: {
    artifactId: string;
    revisionId: string;
  };
  accessLinkId: string;
  pendingUploadSessionId: string;
};

export type RouteBoundaryFixture = {
  repo: PostgresRepository;
  executor: ReturnType<typeof executorForPglite>;
  workspaceA: WorkspaceBoundarySeed;
  workspaceB: WorkspaceActorSeed;
};

async function seedWorkspaceBilling(executor: ReturnType<typeof executorForPglite>, workspaceId: string) {
  const tenant = workspaceExecutor(executor, workspaceId);
  await tenant.query(`update workspaces set plan = 'pro', updated_at = now() where id = $1`, [workspaceId]);
  await tenant.query(
    `insert into workspace_billing
       (workspace_id, stripe_customer_id, stripe_subscription_id, subscription_status,
        current_period_end, price_interval, synced_at, updated_at)
     values ($1, 'cus_rls_a', 'sub_rls_a', 'active', now() + interval '30 days', 'month', now(), now())
     on conflict (workspace_id) do update set
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       subscription_status = excluded.subscription_status,
       current_period_end = excluded.current_period_end,
       price_interval = excluded.price_interval,
       synced_at = excluded.synced_at,
       updated_at = excluded.updated_at`,
    [workspaceId],
  );
}

async function publishArtifact(repo: PostgresRepository, actor: ApiActor, prefix: string, now: string) {
  const session = await repo.createUploadSession({
    actor,
    idempotencyKey: `${prefix}-upload`,
    request: {
      title: "rls-matrix",
      entrypoint: "index.html",
      files: [{ path: "index.html", size_bytes: 12 }],
    },
    now,
  });
  const file = session.files[0];
  if (!file) {
    throw new Error("expected upload file");
  }
  await repo.finalizeUploadSession({
    actor,
    idempotencyKey: `${prefix}-finalize`,
    sessionId: session.upload_session_id,
    observedFiles: [{ path: "index.html", objectKey: file.object_key, sizeBytes: 12 }],
    now,
  });
  await repo.publishRevision({
    actor,
    artifactId: session.artifact_id,
    revisionId: session.revision_id,
    idempotencyKey: `${prefix}-publish`,
    now,
  });
  return {
    artifactId: session.artifact_id,
    revisionId: session.revision_id,
  };
}

async function createPendingUploadSession(repo: PostgresRepository, actor: ApiActor, prefix: string, now: string) {
  const session = await repo.createUploadSession({
    actor,
    idempotencyKey: `${prefix}-pending-upload`,
    request: {
      title: "pending-session",
      entrypoint: "index.html",
      files: [{ path: "index.html", size_bytes: 12 }],
    },
    now,
  });
  return session.upload_session_id;
}

async function seedWorkspaceActors(
  repo: PostgresRepository,
  input: {
    email: string;
    workosUserId: string;
    idempotencyPrefix: string;
    executor: ReturnType<typeof executorForPglite>;
  },
) {
  const workspace = await repo.createWorkspace({
    actor: adminActor,
    idempotencyKey: `${input.idempotencyPrefix}-workspace`,
    email: input.email,
  });
  const key = await repo.createApiKey({
    actor: adminActor,
    idempotencyKey: `${input.idempotencyPrefix}-api-key`,
    workspaceId: workspace.id,
    name: "route-boundary",
  });
  const apiActor = await repo.verifyApiKey(key.secret);
  if (!apiActor) {
    throw new Error("expected api actor");
  }

  const memberId = createId("mem");
  await platformExecutor(input.executor).query(
    `insert into workspace_members
       (id, workspace_id, workos_user_id, email, scopes, created_at, last_seen_at)
     values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $6::timestamptz)`,
    [memberId, workspace.id, input.workosUserId, input.email, JSON.stringify(DEFAULT_MEMBER_SCOPES), fixtureNow],
  );
  const memberActor: ApiActor = {
    type: "member",
    id: memberId,
    workspace_id: workspace.id,
    email: input.email,
    scopes: [...DEFAULT_MEMBER_SCOPES],
  };

  return {
    id: workspace.id,
    apiActor,
    apiKeySecret: key.secret,
    memberActor,
    workosUserId: input.workosUserId,
  };
}

async function seedWorkspaceArtifacts(repo: PostgresRepository, apiActor: ApiActor, idempotencyPrefix: string) {
  const published = await publishArtifact(repo, apiActor, `${idempotencyPrefix}-published`, fixtureNow);
  const accessLink = await repo.createMemberAccessLink({
    actor: apiActor,
    idempotencyKey: `${idempotencyPrefix}-access-link`,
    artifactId: published.artifactId,
    type: "share",
    revisionId: null,
  });
  // The upload route's finalize handler stamps `now` with real wall-clock time and
  // can't be injected, so the session's 24h TTL is measured against the real clock.
  // Seeding at the frozen `fixtureNow` makes finalize flake to `upload_session_expired`
  // (409) once real time passes fixtureNow + 24h. Anchor the pending session to real
  // time so its window is always open when finalize runs.
  const pendingUploadSessionId = await createPendingUploadSession(
    repo,
    apiActor,
    `${idempotencyPrefix}-pending`,
    new Date().toISOString(),
  );
  return { published, accessLinkId: accessLink.id, pendingUploadSessionId };
}

export async function createRouteBoundaryFixture(): Promise<RouteBoundaryFixture> {
  const client = new PGlite();
  await applyMigrations(client);
  const connection = pgliteConnection(client);
  const executor = executorForPglite(client);
  const repo = new PostgresRepository(connection, { apiKeyPepper: "test-pepper" });

  const workspaceACore = await seedWorkspaceActors(repo, {
    email: "member-a@example.com",
    workosUserId: "user_route_boundary_a",
    idempotencyPrefix: "ws-a",
    executor,
  });
  const workspaceBCore = await seedWorkspaceActors(repo, {
    email: "member-b@example.com",
    workosUserId: "user_route_boundary_b",
    idempotencyPrefix: "ws-b",
    executor,
  });
  const workspaceAArtifacts = await seedWorkspaceArtifacts(repo, workspaceACore.apiActor, "ws-a");
  await seedWorkspaceBilling(executor, workspaceACore.id);

  return {
    repo,
    executor,
    workspaceA: {
      ...workspaceACore,
      ...workspaceAArtifacts,
    },
    workspaceB: workspaceBCore,
  };
}
