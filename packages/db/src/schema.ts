import { sql } from "drizzle-orm";
import {
  bigint,
  check,
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

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    contactEmail: text("contact_email"),
    autoDeletionDays: integer("auto_deletion_days").notNull().default(30),
    revisionRetentionDays: integer("revision_retention_days"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("workspaces_auto_deletion_days_check", sql`${table.autoDeletionDays} between 1 and 90`),
    check(
      "workspaces_revision_retention_days_check",
      sql`${table.revisionRetentionDays} is null or ${table.revisionRetentionDays} >= 1`,
    ),
  ],
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
    uniqueIndex("workspace_members_workos_user_unique").on(table.workosUserId),
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
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("api_keys_active_workspace_idx").on(table.workspaceId)],
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
    artifactExpiresAt: timestamp("artifact_expires_at", { withTimezone: true }).notNull(),
    fileCount: integer("file_count").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdByApiKeyId: text("created_by_api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (table) => [index("upload_sessions_pending_expiry_idx").on(table.workspaceId, table.expiresAt)],
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
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    putUrlExpiresAt: timestamp("put_url_expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.uploadSessionId, table.path] })],
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
    createdByApiKeyId: text("created_by_api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "restrict" }),
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
    createdByApiKeyId: text("created_by_api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "restrict" }),
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
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.artifactId, table.revisionId, table.path] })],
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
