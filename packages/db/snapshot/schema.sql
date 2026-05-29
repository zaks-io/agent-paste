CREATE TABLE "access_links" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"artifact_id" text NOT NULL,
	"revision_id" text,
	"public_id" text NOT NULL,
	"type" text NOT NULL,
	"scopes_bitmask" integer NOT NULL,
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
	"expires_at" timestamp with time zone,
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
	"pinned_at" timestamp with time zone,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"access_link_lockdown_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"delete_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "artifacts_created_by_type_check" CHECK ("artifacts"."created_by_type" in ('api_key', 'member'))
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
	"bundle_size_bytes" bigint,
	"bytes_purge_enqueued_at" timestamp with time zone,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "revisions_status_check" CHECK ("revisions"."status" in ('draft', 'published', 'retained')),
	CONSTRAINT "revisions_render_mode_check" CHECK ("revisions"."render_mode" in ('html', 'markdown', 'text', 'image', 'audio', 'video')),
	CONSTRAINT "revisions_bundle_status_check" CHECK ("revisions"."bundle_status" in ('pending', 'ready', 'failed', 'disabled')),
	CONSTRAINT "revisions_created_by_type_check" CHECK ("revisions"."created_by_type" in ('api_key', 'member'))
);

CREATE TABLE "safety_warnings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"artifact_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"scanner_id" text NOT NULL,
	"scanner_version" text NOT NULL,
	"code" text NOT NULL,
	"severity" text NOT NULL,
	"scope" text NOT NULL,
	"file_path" text,
	"message" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "safety_warnings_severity_check" CHECK ("safety_warnings"."severity" in ('info', 'warning')),
	CONSTRAINT "safety_warnings_scope_check" CHECK ("safety_warnings"."scope" in ('artifact', 'revision', 'file')),
	CONSTRAINT "safety_warnings_file_scope_check" CHECK (("safety_warnings"."scope" = 'file' and "safety_warnings"."file_path" is not null) or ("safety_warnings"."scope" <> 'file' and "safety_warnings"."file_path" is null)),
	CONSTRAINT "safety_warnings_code_check" CHECK ("safety_warnings"."code" ~ '^[a-z0-9_]+$')
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
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "upload_sessions_created_by_type_check" CHECK ("upload_sessions"."created_by_type" in ('api_key', 'member'))
);

CREATE TABLE "workspace_billing" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"subscription_status" text,
	"current_period_end" timestamp with time zone,
	"price_interval" text,
	"synced_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_billing_price_interval_check" CHECK ("workspace_billing"."price_interval" is null or "workspace_billing"."price_interval" in ('month', 'year')),
	CONSTRAINT "workspace_billing_subscription_status_check" CHECK ("workspace_billing"."subscription_status" is null or "workspace_billing"."subscription_status" in (
        'active', 'trialing', 'past_due', 'canceled', 'unpaid',
        'incomplete', 'incomplete_expired', 'paused'
      ))
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
	"plan" text DEFAULT 'free' NOT NULL,
	"plan_operator_override_at" timestamp with time zone,
	"auto_deletion_days" integer DEFAULT 30 NOT NULL,
	"revision_retention_days" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspaces_plan_check" CHECK ("workspaces"."plan" in ('free', 'pro')),
	CONSTRAINT "workspaces_auto_deletion_days_check" CHECK ("workspaces"."auto_deletion_days" between 1 and 90),
	CONSTRAINT "workspaces_revision_retention_days_check" CHECK ("workspaces"."revision_retention_days" is null or "workspaces"."revision_retention_days" >= 1)
);

ALTER TABLE "access_links" ADD CONSTRAINT "access_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_artifact_fk" FOREIGN KEY ("workspace_id","artifact_id") REFERENCES "public"."artifacts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_revision_fk" FOREIGN KEY ("workspace_id","artifact_id","revision_id") REFERENCES "public"."revisions"("workspace_id","artifact_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "artifact_files" ADD CONSTRAINT "artifact_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "artifact_files" ADD CONSTRAINT "artifact_files_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "artifact_files" ADD CONSTRAINT "artifact_files_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "operation_events" ADD CONSTRAINT "operation_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "safety_warnings" ADD CONSTRAINT "safety_warnings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "safety_warnings" ADD CONSTRAINT "safety_warnings_revision_fk" FOREIGN KEY ("workspace_id","artifact_id","revision_id") REFERENCES "public"."revisions"("workspace_id","artifact_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "upload_session_files" ADD CONSTRAINT "upload_session_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "upload_session_files" ADD CONSTRAINT "upload_session_files_upload_session_id_upload_sessions_id_fk" FOREIGN KEY ("upload_session_id") REFERENCES "public"."upload_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "workspace_billing" ADD CONSTRAINT "workspace_billing_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
CREATE UNIQUE INDEX "access_links_public_id_unique" ON "access_links" USING btree ("public_id");
CREATE INDEX "access_links_artifact_created_idx" ON "access_links" USING btree ("artifact_id","created_at");
CREATE INDEX "access_links_workspace_idx" ON "access_links" USING btree ("workspace_id");
CREATE INDEX "api_keys_active_workspace_idx" ON "api_keys" USING btree ("workspace_id");
CREATE INDEX "artifacts_workspace_created_idx" ON "artifacts" USING btree ("workspace_id","created_at");
CREATE INDEX "artifacts_active_expiry_idx" ON "artifacts" USING btree ("workspace_id","expires_at");
CREATE UNIQUE INDEX "artifacts_workspace_id_unique" ON "artifacts" USING btree ("workspace_id","id");
CREATE INDEX "idempotency_records_created_idx" ON "idempotency_records" USING btree ("created_at");
CREATE INDEX "operation_events_workspace_occurred_id_idx" ON "operation_events" USING btree ("workspace_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);
CREATE UNIQUE INDEX "platform_lockdowns_effective_unique" ON "platform_lockdowns" USING btree ("scope","target_id") WHERE "platform_lockdowns"."lifted_at" is null;
CREATE INDEX "revisions_artifact_created_idx" ON "revisions" USING btree ("artifact_id","created_at");
CREATE INDEX "revisions_workspace_idx" ON "revisions" USING btree ("workspace_id");
CREATE UNIQUE INDEX "revisions_workspace_artifact_id_unique" ON "revisions" USING btree ("workspace_id","artifact_id","id");
CREATE UNIQUE INDEX "revisions_artifact_number_unique" ON "revisions" USING btree ("artifact_id","revision_number") WHERE "revisions"."revision_number" is not null;
CREATE UNIQUE INDEX "revisions_one_draft_per_artifact" ON "revisions" USING btree ("artifact_id") WHERE "revisions"."status" = 'draft';
CREATE INDEX "safety_warnings_revision_idx" ON "safety_warnings" USING btree ("workspace_id","revision_id");
CREATE INDEX "safety_warnings_scanner_idx" ON "safety_warnings" USING btree ("workspace_id","revision_id","scanner_id");
CREATE INDEX "upload_sessions_pending_expiry_idx" ON "upload_sessions" USING btree ("workspace_id","expires_at");
CREATE UNIQUE INDEX "workspace_billing_stripe_subscription_id_unique" ON "workspace_billing" USING btree ("stripe_subscription_id") WHERE "workspace_billing"."stripe_subscription_id" is not null;
CREATE INDEX "workspace_billing_stripe_customer_idx" ON "workspace_billing" USING btree ("stripe_customer_id") WHERE "workspace_billing"."stripe_customer_id" is not null;
CREATE INDEX "workspace_members_workspace_idx" ON "workspace_members" USING btree ("workspace_id");
CREATE UNIQUE INDEX "workspace_members_workos_user_unique" ON "workspace_members" USING btree ("workos_user_id");
