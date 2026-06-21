// biome-ignore lint: central Drizzle schema intentionally keeps all tables together.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { byteaFromDriver, byteaToDriver } from "./postgres/bytea-codec.js";

const bytea = customType<{ data: Uint8Array; driverData: string | Uint8Array }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Uint8Array) {
    return byteaToDriver(value);
  },
  fromDriver(value: unknown): Uint8Array {
    return byteaFromDriver(value);
  },
});

export const workspacePlans = ["free", "pro"] as const;
export type WorkspacePlan = (typeof workspacePlans)[number];

export const subscriptionStatuses = [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    contactEmail: text("contact_email"),
    plan: text("plan").$type<WorkspacePlan>().notNull().default("free"),
    planOperatorOverrideAt: timestamp("plan_operator_override_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    autoDeletionDays: integer("auto_deletion_days").notNull().default(30),
    revisionRetentionDays: integer("revision_retention_days"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("workspaces_plan_check", sql`${table.plan} in ('free', 'pro')`),
    check("workspaces_auto_deletion_days_check", sql`${table.autoDeletionDays} between 1 and 90`),
    check(
      "workspaces_revision_retention_days_check",
      sql`${table.revisionRetentionDays} is null or ${table.revisionRetentionDays} >= 1`,
    ),
  ],
);

export const workspaceBilling = pgTable(
  "workspace_billing",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    subscriptionStatus: text("subscription_status").$type<SubscriptionStatus | null>(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    priceInterval: text("price_interval").$type<"month" | "year" | null>(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "workspace_billing_price_interval_check",
      sql`${table.priceInterval} is null or ${table.priceInterval} in ('month', 'year')`,
    ),
    check(
      "workspace_billing_subscription_status_check",
      sql`${table.subscriptionStatus} is null or ${table.subscriptionStatus} in (
        'active', 'trialing', 'past_due', 'canceled', 'unpaid',
        'incomplete', 'incomplete_expired', 'paused'
      )`,
    ),
    uniqueIndex("workspace_billing_stripe_subscription_id_unique")
      .on(table.stripeSubscriptionId)
      .where(sql`${table.stripeSubscriptionId} is not null`),
    index("workspace_billing_stripe_customer_idx")
      .on(table.stripeCustomerId)
      .where(sql`${table.stripeCustomerId} is not null`),
  ],
);

export const stripeWebhookEvents = pgTable(
  "stripe_webhook_events",
  {
    eventId: text("event_id").primaryKey(),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("stripe_webhook_events_processed_idx").on(table.processedAt)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    workosUserId: text("workos_user_id").notNull(),
    email: text("email").notNull(),
    scopes: jsonb("scopes").$type<Array<"publish" | "read" | "admin">>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("workspace_members_workspace_idx").on(table.workspaceId),
    unique("workspace_members_workspace_id_id_unique").on(table.workspaceId, table.id),
    uniqueIndex("workspace_members_workos_user_unique").on(table.workosUserId),
  ],
);

export const claimTokens = pgTable(
  "claim_tokens",
  {
    id: text("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    publicId: text("public_id"),
    tokenHash: bytea("token_hash").notNull(),
    pepperKid: smallint("pepper_kid").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("claim_tokens_workspace_idx").on(table.workspaceId),
    uniqueIndex("claim_tokens_public_id_unique").on(table.publicId),
    check("claim_tokens_id_format", sql`${table.id} ~ '^ct_[0-9A-HJKMNP-TV-Z]{26}$'`),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull().unique(),
    name: text("name").notNull(),
    secretHmac: text("secret_hmac").notNull(),
    pepperKid: smallint("pepper_kid").notNull(),
    scopes: jsonb("scopes").$type<Array<"publish" | "read">>().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("api_keys_active_workspace_idx").on(table.workspaceId)],
);

export const agentAuthDelegations = pgTable(
  "agent_auth_delegations",
  {
    id: text("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    workspaceMemberId: text("workspace_member_id")
      .notNull()
      .references(() => workspaceMembers.id, { onDelete: "restrict" }),
    providerIssuer: text("provider_issuer").notNull(),
    providerSubject: text("provider_subject").notNull(),
    audience: text("audience").notNull(),
    providerClientId: text("provider_client_id").notNull(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "agent_auth_delegations_workspace_member_fk",
      columns: [table.workspaceId, table.workspaceMemberId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.id],
    }).onDelete("restrict"),
    index("agent_auth_delegations_workspace_idx").on(table.workspaceId),
    index("agent_auth_delegations_member_idx").on(table.workspaceMemberId),
    uniqueIndex("agent_auth_delegations_active_identity_unique")
      .on(table.providerIssuer, table.providerSubject, table.audience)
      .where(sql`${table.revokedAt} is null`),
  ],
);

export const agentAuthRegistrations = pgTable(
  "agent_auth_registrations",
  {
    id: text("id").primaryKey(),
    registrationType: text("registration_type")
      .$type<"identity_assertion" | "anonymous">()
      .notNull()
      .default("identity_assertion"),
    delegationId: text("delegation_id").references(() => agentAuthDelegations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "restrict" }),
    workspaceMemberId: text("workspace_member_id").references(() => workspaceMembers.id, { onDelete: "restrict" }),
    providerIssuer: text("provider_issuer").notNull(),
    providerSubject: text("provider_subject").notNull(),
    audience: text("audience").notNull(),
    providerClientId: text("provider_client_id").notNull(),
    email: text("email").notNull(),
    status: text("status").notNull(),
    claimTokenId: text("claim_token_id").references(() => claimTokens.id, { onDelete: "restrict" }),
    claimTokenHash: bytea("claim_token_hash"),
    claimAttemptTokenHash: bytea("claim_attempt_token_hash"),
    userCodeHash: bytea("user_code_hash"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    claimAttemptExpiresAt: timestamp("claim_attempt_expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "agent_auth_registrations_workspace_member_fk",
      columns: [table.workspaceId, table.workspaceMemberId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.id],
    }).onDelete("restrict"),
    index("agent_auth_registrations_delegation_idx").on(table.delegationId),
    index("agent_auth_registrations_claim_idx").on(table.claimTokenHash),
    index("agent_auth_registrations_claim_attempt_idx").on(table.claimAttemptTokenHash),
    index("agent_auth_registrations_claim_token_id_idx").on(table.claimTokenId),
    check("agent_auth_registrations_type_check", sql`${table.registrationType} in ('identity_assertion', 'anonymous')`),
    check(
      "agent_auth_registrations_status_check",
      sql`${table.status} in (
        'verified', 'pending_step_up', 'anonymous_unclaimed',
        'anonymous_claim_pending', 'revoked'
      )`,
    ),
  ],
);

export const agentAuthJtis = pgTable(
  "agent_auth_jtis",
  {
    providerIssuer: text("provider_issuer").notNull(),
    jti: text("jti").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.providerIssuer, table.jti] }),
    index("agent_auth_jtis_expires_idx").on(table.expiresAt),
  ],
);

export const agentAuthAccessTokens = pgTable(
  "agent_auth_access_tokens",
  {
    apiKeyId: text("api_key_id")
      .primaryKey()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    registrationId: text("registration_id")
      .notNull()
      .references(() => agentAuthRegistrations.id, { onDelete: "restrict" }),
    delegationId: text("delegation_id").references(() => agentAuthDelegations.id, { onDelete: "restrict" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("agent_auth_access_tokens_delegation_idx").on(table.delegationId)],
);

export const uploadSessions = pgTable(
  "upload_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    artifactId: text("artifact_id").notNull(),
    revisionId: text("revision_id").notNull(),
    status: text("status").notNull(),
    title: text("title").notNull(),
    entrypoint: text("entrypoint").notNull(),
    renderMode: text("render_mode"),
    artifactExpiresAt: timestamp("artifact_expires_at", { withTimezone: true }).notNull(),
    fileCount: integer("file_count").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    // Base Revision this publish inherits from (ADR 0089 tree inheritance). Null = full
    // manifest. Copied to revisions.parent_revision_id when the merge runs at finalize.
    baseRevisionId: text("base_revision_id"),
    // Base paths this publish drops. Needed to tell a deleted path apart from an
    // inherited one at finalize (both are base paths absent from the file manifest).
    deletedPaths: jsonb("deleted_paths").$type<string[]>().notNull().default([]),
  },
  (table) => [
    index("upload_sessions_pending_expiry_idx").on(table.workspaceId, table.expiresAt),
    check("upload_sessions_created_by_type_check", sql`${table.createdByType} in ('api_key', 'member')`),
    check(
      "upload_sessions_render_mode_check",
      sql`${table.renderMode} is null or ${table.renderMode} in ('html', 'markdown', 'text', 'image', 'audio', 'video')`,
    ),
  ],
);

export const uploadSessionFiles = pgTable(
  "upload_session_files",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    uploadSessionId: text("upload_session_id")
      .notNull()
      .references(() => uploadSessions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    servedContentType: text("served_content_type").notNull(),
    r2Key: text("r2_key").notNull(),
    sha256: text("sha256"),
    storageKind: text("storage_kind").notNull().default("revision"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    putUrlExpiresAt: timestamp("put_url_expires_at", { withTimezone: true }).notNull(),
    // Intra-file delta descriptor (ADR 0089). When set, the uploaded bytes are a
    // unified diff against the base file; jobs reconstructs the whole result blob
    // (Stage 4). base = digest of the base Revision's file, result = digest of the
    // reconstructed whole file. Both null (whole-file upload) or both set.
    patchBaseSha256: text("patch_base_sha256"),
    patchResultSha256: text("patch_result_sha256"),
  },
  (table) => [
    primaryKey({ columns: [table.uploadSessionId, table.path] }),
    index("upload_session_files_blob_idx").on(table.workspaceId, table.sha256, table.sizeBytes),
    check("upload_session_files_storage_kind_check", sql`${table.storageKind} in ('revision', 'blob')`),
    check("upload_session_files_sha256_check", sql`${table.sha256} is null or ${table.sha256} ~ '^[a-f0-9]{64}$'`),
    check(
      "upload_session_files_patch_check",
      sql`(${table.patchBaseSha256} is null and ${table.patchResultSha256} is null) or (${table.patchBaseSha256} ~ '^[a-f0-9]{64}$' and ${table.patchResultSha256} ~ '^[a-f0-9]{64}$')`,
    ),
  ],
);

export const revisions = pgTable(
  "revisions",
  {
    id: text("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    parentRevisionId: text("parent_revision_id"),
    revisionNumber: integer("revision_number"),
    status: text("status").notNull(),
    entrypoint: text("entrypoint").notNull(),
    renderMode: text("render_mode").notNull().default("html"),
    fileCount: integer("file_count").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    bundleStatus: text("bundle_status").notNull().default("disabled"),
    bundleStatusUpdatedAt: timestamp("bundle_status_updated_at", { withTimezone: true }),
    bundleSizeBytes: bigint("bundle_size_bytes", { mode: "number" }),
    bytesPurgeEnqueuedAt: timestamp("bytes_purge_enqueued_at", { withTimezone: true }),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    index("revisions_artifact_created_idx").on(table.artifactId, table.createdAt),
    index("revisions_workspace_idx").on(table.workspaceId),
    uniqueIndex("revisions_workspace_artifact_id_unique").on(table.workspaceId, table.artifactId, table.id),
    uniqueIndex("revisions_artifact_number_unique")
      .on(table.artifactId, table.revisionNumber)
      .where(sql`${table.revisionNumber} is not null`),
    uniqueIndex("revisions_one_draft_per_artifact").on(table.artifactId).where(sql`${table.status} = 'draft'`),
    check("revisions_status_check", sql`${table.status} in ('draft', 'published', 'retained')`),
    check(
      "revisions_render_mode_check",
      sql`${table.renderMode} in ('html', 'markdown', 'text', 'image', 'audio', 'video')`,
    ),
    check("revisions_bundle_status_check", sql`${table.bundleStatus} in ('pending', 'ready', 'failed', 'disabled')`),
    check("revisions_created_by_type_check", sql`${table.createdByType} in ('api_key', 'member')`),
    index("revisions_parent_idx").on(table.workspaceId, table.artifactId, table.parentRevisionId),
    // Migration 0024 is authoritative for this constraint: it uses the PostgreSQL
    // column-scoped `ON DELETE SET NULL (parent_revision_id)` so deleting a parent
    // only nulls the (nullable) parent pointer, never workspace_id/artifact_id (both
    // NOT NULL). Drizzle cannot express the column list, so this `.onDelete("set null")`
    // is the closest ORM approximation; the snapshot it generates is drift-detection
    // for schema.ts, not the DDL applied to the database. Do NOT "fix" the migration to
    // match the snapshot's unscoped SET NULL — that would violate the NOT NULL columns.
    foreignKey({
      name: "revisions_parent_fk",
      columns: [table.workspaceId, table.artifactId, table.parentRevisionId],
      foreignColumns: [table.workspaceId, table.artifactId, table.id],
    }).onDelete("set null"),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    revisionId: text("revision_id"),
    status: text("status").notNull(),
    title: text("title").notNull(),
    entrypoint: text("entrypoint").notNull(),
    fileCount: integer("file_count").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    accessLinkLockdownAt: timestamp("access_link_lockdown_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deleteReason: text("delete_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("artifacts_workspace_created_idx").on(table.workspaceId, table.createdAt),
    index("artifacts_active_expiry_idx").on(table.workspaceId, table.expiresAt),
    uniqueIndex("artifacts_workspace_id_unique").on(table.workspaceId, table.id),
    check("artifacts_created_by_type_check", sql`${table.createdByType} in ('api_key', 'member')`),
  ],
);

export const contentBlobs = pgTable(
  "content_blobs",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    r2Key: text("r2_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.sha256, table.sizeBytes] }),
    uniqueIndex("content_blobs_r2_key_unique").on(table.r2Key),
    check("content_blobs_sha256_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
    check("content_blobs_size_bytes_check", sql`${table.sizeBytes} >= 0`),
  ],
);

export const artifactFiles = pgTable(
  "artifact_files",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => revisions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    servedContentType: text("served_content_type").notNull(),
    r2Key: text("r2_key").notNull(),
    sha256: text("sha256"),
    storageKind: text("storage_kind").notNull().default("revision"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.revisionId, table.path] }),
    index("artifact_files_blob_idx").on(table.workspaceId, table.sha256, table.sizeBytes),
    check("artifact_files_storage_kind_check", sql`${table.storageKind} in ('revision', 'blob')`),
    check("artifact_files_sha256_check", sql`${table.sha256} is null or ${table.sha256} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const safetyWarnings = pgTable(
  "safety_warnings",
  {
    id: text("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    artifactId: text("artifact_id").notNull(),
    revisionId: text("revision_id").notNull(),
    scannerId: text("scanner_id").notNull(),
    scannerVersion: text("scanner_version").notNull(),
    code: text("code").notNull(),
    severity: text("severity").notNull(),
    scope: text("scope").notNull(),
    filePath: text("file_path"),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("safety_warnings_revision_idx").on(table.workspaceId, table.revisionId),
    index("safety_warnings_scanner_idx").on(table.workspaceId, table.revisionId, table.scannerId),
    check("safety_warnings_severity_check", sql`${table.severity} in ('info', 'warning')`),
    check("safety_warnings_scope_check", sql`${table.scope} in ('artifact', 'revision', 'file')`),
    check(
      "safety_warnings_file_scope_check",
      sql`(${table.scope} = 'file' and ${table.filePath} is not null) or (${table.scope} <> 'file' and ${table.filePath} is null)`,
    ),
    check("safety_warnings_code_check", sql`${table.code} ~ '^[a-z0-9_]+$'`),
    foreignKey({
      name: "safety_warnings_revision_fk",
      columns: [table.workspaceId, table.artifactId, table.revisionId],
      foreignColumns: [revisions.workspaceId, revisions.artifactId, revisions.id],
    }).onDelete("cascade"),
  ],
);

export const operationEvents = pgTable(
  "operation_events",
  {
    id: text("id").primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "restrict" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    requestId: text("request_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("operation_events_workspace_occurred_id_idx").on(table.workspaceId, table.occurredAt.desc(), table.id.desc()),
    check(
      "operation_events_actor_type_check",
      sql`${table.actorType} in ('api_key', 'member', 'admin', 'system', 'platform')`,
    ),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    workspaceId: uuid("workspace_id"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    resultJson: jsonb("result_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    unique("idempotency_records_unique")
      .on(table.workspaceId, table.actorType, table.actorId, table.operation, table.idempotencyKey)
      .nullsNotDistinct(),
    index("idempotency_records_created_idx").on(table.createdAt),
    check(
      "idempotency_records_actor_type_check",
      sql`${table.actorType} in ('api_key', 'member', 'admin', 'system', 'platform')`,
    ),
  ],
);

export const accessLinks = pgTable(
  "access_links",
  {
    id: text("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    artifactId: text("artifact_id").notNull(),
    revisionId: text("revision_id"),
    publicId: text("public_id").notNull(),
    type: text("type").notNull(),
    scopesBitmask: integer("scopes_bitmask").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("access_links_public_id_unique").on(table.publicId),
    index("access_links_artifact_created_idx").on(table.artifactId, table.createdAt),
    index("access_links_workspace_idx").on(table.workspaceId),
    check("access_links_type_check", sql`${table.type} in ('share', 'revision')`),
    check(
      "access_links_type_revision_check",
      sql`(${table.type} = 'share' and ${table.revisionId} is null) or (${table.type} = 'revision' and ${table.revisionId} is not null)`,
    ),
    check("access_links_created_by_type_check", sql`${table.createdByType} in ('api_key', 'member')`),
    check("access_links_scopes_bitmask_check", sql`${table.scopesBitmask} between 0 and 65535`),
    check("access_links_public_id_format", sql`${table.publicId} ~ '^[0-9A-HJKMNP-TV-Z]{16}$'`),
    foreignKey({
      name: "access_links_artifact_fk",
      columns: [table.workspaceId, table.artifactId],
      foreignColumns: [artifacts.workspaceId, artifacts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "access_links_revision_fk",
      columns: [table.workspaceId, table.artifactId, table.revisionId],
      foreignColumns: [revisions.workspaceId, revisions.artifactId, revisions.id],
    }).onDelete("cascade"),
  ],
);

export const platformLockdowns = pgTable(
  "platform_lockdowns",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    targetId: text("target_id").notNull(),
    reasonCode: text("reason_code").notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull(),
    setBy: text("set_by").notNull(),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
    liftedBy: text("lifted_by"),
  },
  (table) => [
    check("platform_lockdowns_scope_check", sql`${table.scope} in ('workspace', 'artifact')`),
    uniqueIndex("platform_lockdowns_effective_unique")
      .on(table.scope, table.targetId)
      .where(sql`${table.liftedAt} is null`),
  ],
);
