CREATE TABLE "access_links" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"artifact_id" text NOT NULL,
	"revision_id" text,
	"public_id" text NOT NULL,
	"type" text NOT NULL,
	"scopes_bitmask" smallint NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "access_links_type_check" CHECK ("access_links"."type" in ('share', 'revision')),
	CONSTRAINT "access_links_type_revision_check" CHECK (("access_links"."type" = 'share' and "access_links"."revision_id" is null) or ("access_links"."type" = 'revision' and "access_links"."revision_id" is not null)),
	CONSTRAINT "access_links_created_by_type_check" CHECK ("access_links"."created_by_type" in ('api_key', 'member')),
	CONSTRAINT "access_links_scopes_bitmask_check" CHECK ("access_links"."scopes_bitmask" between 0 and 65535),
	CONSTRAINT "access_links_public_id_format" CHECK ("access_links"."public_id" ~ '^[0-9A-HJKMNP-TV-Z]{16}$')
);

CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"name" text NOT NULL,
	"secret_hmac" text NOT NULL,
	"pepper_kid" smallint NOT NULL,
	"scopes" jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "api_keys_public_id_unique" UNIQUE("public_id")
);

CREATE TABLE "artifact_files" (
	"workspace_id" uuid NOT NULL,
	"artifact_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"path" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"served_content_type" text NOT NULL,
	"r2_key" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "artifact_files_artifact_id_revision_id_path_pk" PRIMARY KEY("artifact_id","revision_id","path")
);

CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"revision_id" text,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"entrypoint" text NOT NULL,
	"file_count" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_api_key_id" text NOT NULL,
	"access_link_lockdown_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"delete_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "idempotency_records" (
	"workspace_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"result_json" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_records_unique" UNIQUE NULLS NOT DISTINCT("workspace_id","actor_type","actor_id","operation","idempotency_key"),
	CONSTRAINT "idempotency_records_actor_type_check" CHECK ("idempotency_records"."actor_type" in ('api_key', 'member', 'admin', 'system', 'platform'))
);

CREATE TABLE "operation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"details" jsonb NOT NULL,
	"request_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "operation_events_actor_type_check" CHECK ("operation_events"."actor_type" in ('api_key', 'member', 'admin', 'system', 'platform'))
);

CREATE TABLE "platform_lockdowns" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"target_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	"set_by" text NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" text,
	CONSTRAINT "platform_lockdowns_scope_check" CHECK ("platform_lockdowns"."scope" in ('workspace', 'artifact'))
);

CREATE TABLE "revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"artifact_id" text NOT NULL,
	"revision_number" integer,
	"status" text NOT NULL,
	"entrypoint" text NOT NULL,
	"render_mode" text DEFAULT 'html' NOT NULL,
	"file_count" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"bundle_status" text DEFAULT 'disabled' NOT NULL,
	"bundle_status_updated_at" timestamp with time zone,
	"bytes_purge_enqueued_at" timestamp with time zone,
	"created_by_api_key_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "revisions_status_check" CHECK ("revisions"."status" in ('draft', 'published', 'retained')),
	CONSTRAINT "revisions_render_mode_check" CHECK ("revisions"."render_mode" in ('html', 'markdown', 'text', 'image', 'audio', 'video')),
	CONSTRAINT "revisions_bundle_status_check" CHECK ("revisions"."bundle_status" in ('pending', 'ready', 'failed', 'disabled'))
);

CREATE TABLE "upload_session_files" (
	"workspace_id" uuid NOT NULL,
	"upload_session_id" text NOT NULL,
	"path" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"served_content_type" text NOT NULL,
	"r2_key" text NOT NULL,
	"uploaded_at" timestamp with time zone,
	"put_url_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "upload_session_files_upload_session_id_path_pk" PRIMARY KEY("upload_session_id","path")
);

CREATE TABLE "upload_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"artifact_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"entrypoint" text NOT NULL,
	"artifact_expires_at" timestamp with time zone NOT NULL,
	"file_count" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_by_api_key_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone
);

CREATE TABLE "workspace_members" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workos_user_id" text NOT NULL,
	"email" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);

CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_email" text,
	"auto_deletion_days" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspaces_auto_deletion_days_check" CHECK ("workspaces"."auto_deletion_days" between 1 and 90)
);

ALTER TABLE "access_links" ADD CONSTRAINT "access_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "artifact_files" ADD CONSTRAINT "artifact_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "artifact_files" ADD CONSTRAINT "artifact_files_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "artifact_files" ADD CONSTRAINT "artifact_files_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_api_key_id_api_keys_id_fk" FOREIGN KEY ("created_by_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "operation_events" ADD CONSTRAINT "operation_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_created_by_api_key_id_api_keys_id_fk" FOREIGN KEY ("created_by_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "upload_session_files" ADD CONSTRAINT "upload_session_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "upload_session_files" ADD CONSTRAINT "upload_session_files_upload_session_id_upload_sessions_id_fk" FOREIGN KEY ("upload_session_id") REFERENCES "public"."upload_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_created_by_api_key_id_api_keys_id_fk" FOREIGN KEY ("created_by_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
CREATE UNIQUE INDEX "access_links_public_id_unique" ON "access_links" USING btree ("public_id");
CREATE INDEX "access_links_artifact_created_idx" ON "access_links" USING btree ("artifact_id","created_at");
CREATE INDEX "access_links_workspace_idx" ON "access_links" USING btree ("workspace_id");
CREATE INDEX "api_keys_active_workspace_idx" ON "api_keys" USING btree ("workspace_id");
CREATE INDEX "artifacts_workspace_created_idx" ON "artifacts" USING btree ("workspace_id","created_at");
CREATE INDEX "artifacts_active_expiry_idx" ON "artifacts" USING btree ("workspace_id","expires_at");
CREATE INDEX "idempotency_records_created_idx" ON "idempotency_records" USING btree ("created_at");
CREATE INDEX "operation_events_workspace_occurred_id_idx" ON "operation_events" USING btree ("workspace_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);
CREATE UNIQUE INDEX "platform_lockdowns_effective_unique" ON "platform_lockdowns" USING btree ("scope","target_id") WHERE "platform_lockdowns"."lifted_at" is null;
CREATE INDEX "revisions_artifact_created_idx" ON "revisions" USING btree ("artifact_id","created_at");
CREATE INDEX "revisions_workspace_idx" ON "revisions" USING btree ("workspace_id");
CREATE UNIQUE INDEX "revisions_artifact_number_unique" ON "revisions" USING btree ("artifact_id","revision_number") WHERE "revisions"."revision_number" is not null;
CREATE UNIQUE INDEX "revisions_one_draft_per_artifact" ON "revisions" USING btree ("artifact_id") WHERE "revisions"."status" = 'draft';
CREATE INDEX "upload_sessions_pending_expiry_idx" ON "upload_sessions" USING btree ("workspace_id","expires_at");
CREATE INDEX "workspace_members_workspace_idx" ON "workspace_members" USING btree ("workspace_id");
CREATE UNIQUE INDEX "workspace_members_workos_user_unique" ON "workspace_members" USING btree ("workos_user_id");
