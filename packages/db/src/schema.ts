import { sql } from "drizzle-orm";
import {
  bigint,
  check,
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

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  contactEmail: text("contact_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

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

export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    revisionId: text("revision_id").notNull().unique(),
    status: text("status").notNull(),
    title: text("title").notNull(),
    entrypoint: text("entrypoint").notNull(),
    fileCount: integer("file_count").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdByApiKeyId: text("created_by_api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "restrict" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deleteReason: text("delete_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("artifacts_workspace_created_idx").on(table.workspaceId, table.createdAt),
    index("artifacts_active_expiry_idx").on(table.workspaceId, table.expiresAt),
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
    revisionId: text("revision_id").notNull(),
    path: text("path").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    servedContentType: text("served_content_type").notNull(),
    r2Key: text("r2_key").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.artifactId, table.path] })],
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
    check("operation_events_actor_type_check", sql`${table.actorType} in ('api_key', 'member', 'admin', 'system')`),
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
    check("idempotency_records_actor_type_check", sql`${table.actorType} in ('api_key', 'member', 'admin', 'system')`),
  ],
);
