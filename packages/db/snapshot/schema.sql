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

CREATE TABLE "agent_auth_access_tokens" (
	"api_key_id" text PRIMARY KEY NOT NULL,
	"registration_id" text NOT NULL,
	"delegation_id" text,
	"issued_at" timestamp with time zone NOT NULL
);

CREATE TABLE "agent_auth_delegations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workspace_member_id" text NOT NULL,
	"provider_issuer" text NOT NULL,
	"provider_subject" text NOT NULL,
	"audience" text NOT NULL,
	"provider_client_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);

CREATE TABLE "agent_auth_jtis" (
	"provider_issuer" text NOT NULL,
	"jti" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_auth_jtis_provider_issuer_jti_pk" PRIMARY KEY("provider_issuer","jti")
);

CREATE TABLE "agent_auth_registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"registration_type" text DEFAULT 'identity_assertion' NOT NULL,
	"delegation_id" text,
	"workspace_id" uuid,
	"workspace_member_id" text,
	"provider_issuer" text NOT NULL,
	"provider_subject" text NOT NULL,
	"audience" text NOT NULL,
	"provider_client_id" text NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"claim_token_id" text,
	"claim_token_hash" "bytea",
	"claim_attempt_token_hash" "bytea",
	"user_code_hash" "bytea",
	"claim_expires_at" timestamp with time zone,
	"claim_attempt_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_auth_registrations_type_check" CHECK ("agent_auth_registrations"."registration_type" in ('identity_assertion', 'anonymous')),
	CONSTRAINT "agent_auth_registrations_member_workspace_check" CHECK ("agent_auth_registrations"."workspace_member_id" is null or "agent_auth_registrations"."workspace_id" is not null),
	CONSTRAINT "agent_auth_registrations_status_check" CHECK ("agent_auth_registrations"."status" in (
        'verified', 'pending_step_up', 'anonymous_unclaimed',
        'anonymous_claim_pending', 'revoked'
      ))
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
	"sha256" text,
	"storage_kind" text DEFAULT 'revision' NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "artifact_files_artifact_id_revision_id_path_pk" PRIMARY KEY("artifact_id","revision_id","path"),
	CONSTRAINT "artifact_files_storage_kind_check" CHECK ("artifact_files"."storage_kind" in ('revision', 'blob')),
	CONSTRAINT "artifact_files_sha256_check" CHECK ("artifact_files"."sha256" is null or "artifact_files"."sha256" ~ '^[a-f0-9]{64}$')
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

CREATE TABLE "claim_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"public_id" text,
	"token_hash" "bytea" NOT NULL,
	"pepper_kid" smallint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "claim_tokens_id_format" CHECK ("claim_tokens"."id" ~ '^ct_[0-9A-HJKMNP-TV-Z]{26}$')
);

CREATE TABLE "content_blobs" (
	"workspace_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"r2_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "content_blobs_workspace_id_sha256_size_bytes_pk" PRIMARY KEY("workspace_id","sha256","size_bytes"),
	CONSTRAINT "content_blobs_sha256_check" CHECK ("content_blobs"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "content_blobs_size_bytes_check" CHECK ("content_blobs"."size_bytes" >= 0)
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
	"parent_revision_id" text,
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

CREATE TABLE "stripe_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"processing_started_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "upload_session_files" (
	"workspace_id" uuid NOT NULL,
	"upload_session_id" text NOT NULL,
	"path" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"served_content_type" text NOT NULL,
	"r2_key" text NOT NULL,
	"sha256" text,
	"storage_kind" text DEFAULT 'revision' NOT NULL,
	"uploaded_at" timestamp with time zone,
	"put_url_expires_at" timestamp with time zone NOT NULL,
	"patch_base_sha256" text,
	"patch_result_sha256" text,
	CONSTRAINT "upload_session_files_upload_session_id_path_pk" PRIMARY KEY("upload_session_id","path"),
	CONSTRAINT "upload_session_files_storage_kind_check" CHECK ("upload_session_files"."storage_kind" in ('revision', 'blob')),
	CONSTRAINT "upload_session_files_sha256_check" CHECK ("upload_session_files"."sha256" is null or "upload_session_files"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "upload_session_files_patch_check" CHECK (("upload_session_files"."patch_base_sha256" is null and "upload_session_files"."patch_result_sha256" is null) or ("upload_session_files"."patch_base_sha256" ~ '^[a-f0-9]{64}$' and "upload_session_files"."patch_result_sha256" ~ '^[a-f0-9]{64}$'))
);

CREATE TABLE "upload_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"artifact_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"entrypoint" text NOT NULL,
	"render_mode" text,
	"artifact_expires_at" timestamp with time zone NOT NULL,
	"file_count" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"base_revision_id" text,
	"deleted_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "upload_sessions_created_by_type_check" CHECK ("upload_sessions"."created_by_type" in ('api_key', 'member')),
	CONSTRAINT "upload_sessions_render_mode_check" CHECK ("upload_sessions"."render_mode" is null or "upload_sessions"."render_mode" in ('html', 'markdown', 'text', 'image', 'audio', 'video'))
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
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_id_unique" UNIQUE("workspace_id","id")
);

CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_email" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"plan_operator_override_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
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
ALTER TABLE "agent_auth_access_tokens" ADD CONSTRAINT "agent_auth_access_tokens_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_auth_access_tokens" ADD CONSTRAINT "agent_auth_access_tokens_registration_id_agent_auth_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."agent_auth_registrations"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_auth_access_tokens" ADD CONSTRAINT "agent_auth_access_tokens_delegation_id_agent_auth_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."agent_auth_delegations"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_auth_delegations" ADD CONSTRAINT "agent_auth_delegations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_auth_delegations" ADD CONSTRAINT "agent_auth_delegations_workspace_member_fk" FOREIGN KEY ("workspace_id","workspace_member_id") REFERENCES "public"."workspace_members"("workspace_id","id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_auth_registrations" ADD CONSTRAINT "agent_auth_registrations_delegation_id_agent_auth_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."agent_auth_delegations"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_auth_registrations" ADD CONSTRAINT "agent_auth_registrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_auth_registrations" ADD CONSTRAINT "agent_auth_registrations_claim_token_id_claim_tokens_id_fk" FOREIGN KEY ("claim_token_id") REFERENCES "public"."claim_tokens"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_auth_registrations" ADD CONSTRAINT "agent_auth_registrations_workspace_member_fk" FOREIGN KEY ("workspace_id","workspace_member_id") REFERENCES "public"."workspace_members"("workspace_id","id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "artifact_files" ADD CONSTRAINT "artifact_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "artifact_files" ADD CONSTRAINT "artifact_files_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "artifact_files" ADD CONSTRAINT "artifact_files_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "claim_tokens" ADD CONSTRAINT "claim_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "content_blobs" ADD CONSTRAINT "content_blobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "operation_events" ADD CONSTRAINT "operation_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_parent_fk" FOREIGN KEY ("workspace_id","artifact_id","parent_revision_id") REFERENCES "public"."revisions"("workspace_id","artifact_id","id") ON DELETE set null ON UPDATE no action;
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
CREATE INDEX "agent_auth_access_tokens_delegation_idx" ON "agent_auth_access_tokens" USING btree ("delegation_id");
CREATE INDEX "agent_auth_delegations_workspace_idx" ON "agent_auth_delegations" USING btree ("workspace_id");
CREATE INDEX "agent_auth_delegations_member_idx" ON "agent_auth_delegations" USING btree ("workspace_member_id");
CREATE UNIQUE INDEX "agent_auth_delegations_active_identity_unique" ON "agent_auth_delegations" USING btree ("provider_issuer","provider_subject","audience") WHERE "agent_auth_delegations"."revoked_at" is null;
CREATE INDEX "agent_auth_jtis_expires_idx" ON "agent_auth_jtis" USING btree ("expires_at");
CREATE INDEX "agent_auth_registrations_delegation_idx" ON "agent_auth_registrations" USING btree ("delegation_id");
CREATE INDEX "agent_auth_registrations_claim_idx" ON "agent_auth_registrations" USING btree ("claim_token_hash");
CREATE INDEX "agent_auth_registrations_claim_attempt_idx" ON "agent_auth_registrations" USING btree ("claim_attempt_token_hash");
CREATE INDEX "agent_auth_registrations_claim_token_id_idx" ON "agent_auth_registrations" USING btree ("claim_token_id");
CREATE INDEX "api_keys_active_workspace_idx" ON "api_keys" USING btree ("workspace_id");
CREATE INDEX "artifact_files_blob_idx" ON "artifact_files" USING btree ("workspace_id","sha256","size_bytes");
CREATE INDEX "artifacts_workspace_created_idx" ON "artifacts" USING btree ("workspace_id","created_at");
CREATE INDEX "artifacts_active_expiry_idx" ON "artifacts" USING btree ("workspace_id","expires_at");
CREATE UNIQUE INDEX "artifacts_workspace_id_unique" ON "artifacts" USING btree ("workspace_id","id");
CREATE INDEX "claim_tokens_workspace_idx" ON "claim_tokens" USING btree ("workspace_id");
CREATE UNIQUE INDEX "claim_tokens_public_id_unique" ON "claim_tokens" USING btree ("public_id");
CREATE UNIQUE INDEX "content_blobs_r2_key_unique" ON "content_blobs" USING btree ("r2_key");
CREATE INDEX "idempotency_records_created_idx" ON "idempotency_records" USING btree ("created_at");
CREATE INDEX "operation_events_workspace_occurred_id_idx" ON "operation_events" USING btree ("workspace_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);
CREATE UNIQUE INDEX "platform_lockdowns_effective_unique" ON "platform_lockdowns" USING btree ("scope","target_id") WHERE "platform_lockdowns"."lifted_at" is null;
CREATE INDEX "revisions_artifact_created_idx" ON "revisions" USING btree ("artifact_id","created_at");
CREATE INDEX "revisions_workspace_idx" ON "revisions" USING btree ("workspace_id");
CREATE UNIQUE INDEX "revisions_workspace_artifact_id_unique" ON "revisions" USING btree ("workspace_id","artifact_id","id");
CREATE UNIQUE INDEX "revisions_artifact_number_unique" ON "revisions" USING btree ("artifact_id","revision_number") WHERE "revisions"."revision_number" is not null;
CREATE UNIQUE INDEX "revisions_one_draft_per_artifact" ON "revisions" USING btree ("artifact_id") WHERE "revisions"."status" = 'draft';
CREATE INDEX "revisions_parent_idx" ON "revisions" USING btree ("workspace_id","artifact_id","parent_revision_id");
CREATE INDEX "safety_warnings_revision_idx" ON "safety_warnings" USING btree ("workspace_id","revision_id");
CREATE INDEX "safety_warnings_scanner_idx" ON "safety_warnings" USING btree ("workspace_id","revision_id","scanner_id");
CREATE INDEX "stripe_webhook_events_processed_idx" ON "stripe_webhook_events" USING btree ("processed_at");
CREATE INDEX "upload_session_files_blob_idx" ON "upload_session_files" USING btree ("workspace_id","sha256","size_bytes");
CREATE INDEX "upload_sessions_pending_expiry_idx" ON "upload_sessions" USING btree ("workspace_id","expires_at");
CREATE UNIQUE INDEX "workspace_billing_stripe_subscription_id_unique" ON "workspace_billing" USING btree ("stripe_subscription_id") WHERE "workspace_billing"."stripe_subscription_id" is not null;
CREATE INDEX "workspace_billing_stripe_customer_idx" ON "workspace_billing" USING btree ("stripe_customer_id") WHERE "workspace_billing"."stripe_customer_id" is not null;
CREATE INDEX "workspace_members_workspace_idx" ON "workspace_members" USING btree ("workspace_id");
CREATE UNIQUE INDEX "workspace_members_workos_user_unique" ON "workspace_members" USING btree ("workos_user_id");
