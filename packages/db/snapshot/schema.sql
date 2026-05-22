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
	CONSTRAINT "artifact_files_artifact_id_path_pk" PRIMARY KEY("artifact_id","path")
);

CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"revision_id" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"entrypoint" text NOT NULL,
	"file_count" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_api_key_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"delete_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "artifacts_revision_id_unique" UNIQUE("revision_id")
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
	CONSTRAINT "idempotency_records_unique" UNIQUE NULLS NOT DISTINCT("workspace_id","actor_type","actor_id","operation","idempotency_key")
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
	"occurred_at" timestamp with time zone NOT NULL
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

CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_email" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "artifact_files" ADD CONSTRAINT "artifact_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "artifact_files" ADD CONSTRAINT "artifact_files_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_api_key_id_api_keys_id_fk" FOREIGN KEY ("created_by_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "operation_events" ADD CONSTRAINT "operation_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "upload_session_files" ADD CONSTRAINT "upload_session_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "upload_session_files" ADD CONSTRAINT "upload_session_files_upload_session_id_upload_sessions_id_fk" FOREIGN KEY ("upload_session_id") REFERENCES "public"."upload_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_created_by_api_key_id_api_keys_id_fk" FOREIGN KEY ("created_by_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE restrict ON UPDATE no action;
CREATE INDEX "api_keys_active_workspace_idx" ON "api_keys" USING btree ("workspace_id");
CREATE INDEX "artifacts_workspace_created_idx" ON "artifacts" USING btree ("workspace_id","created_at");
CREATE INDEX "artifacts_active_expiry_idx" ON "artifacts" USING btree ("workspace_id","expires_at");
CREATE INDEX "idempotency_records_created_idx" ON "idempotency_records" USING btree ("created_at");
CREATE INDEX "operation_events_workspace_occurred_idx" ON "operation_events" USING btree ("workspace_id","occurred_at");
CREATE INDEX "upload_sessions_pending_expiry_idx" ON "upload_sessions" USING btree ("workspace_id","expires_at");
