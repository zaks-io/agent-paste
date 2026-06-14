-- ADR 0087 Stage 3: partial-manifest publish carriers on the upload session.
--
-- upload_sessions.base_revision_id records the Revision this publish inherits
-- from; the tree merge runs at finalize and copies it to
-- revisions.parent_revision_id. Null = full manifest (today's behavior).
-- upload_sessions.deleted_paths records base paths this publish drops, so finalize
-- can tell a deleted path apart from an inherited one.
--
-- upload_session_files.patch_base_sha256 / patch_result_sha256 record an
-- intra-file delta: the uploaded bytes are a unified diff against the base file,
-- and jobs reconstructs the whole result blob in Stage 4. Both null (whole-file
-- upload) or both set, each a sha256 hex digest. Stage 3 only records + validates
-- them; it never applies the diff.
--
-- Migrations are applied in filename order with no journal, so every statement is
-- idempotent (re-run safe).

begin;

alter table upload_sessions
  add column if not exists base_revision_id text,
  add column if not exists deleted_paths jsonb not null default '[]'::jsonb;

alter table upload_session_files
  add column if not exists patch_base_sha256 text,
  add column if not exists patch_result_sha256 text;

alter table upload_session_files
  drop constraint if exists upload_session_files_patch_check,
  add constraint upload_session_files_patch_check
    check (
      (patch_base_sha256 is null and patch_result_sha256 is null)
      or (patch_base_sha256 ~ '^[a-f0-9]{64}$' and patch_result_sha256 ~ '^[a-f0-9]{64}$')
    );

commit;
