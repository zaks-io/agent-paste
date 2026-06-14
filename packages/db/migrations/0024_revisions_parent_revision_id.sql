begin;

-- Revision commit chain (ADR 0088): a Revision may point at the Revision it was
-- published against. NULL means a root (every pre-existing row is a root; no
-- backfill). The composite self-FK references (workspace_id, artifact_id, id) so
-- a parent is structurally guaranteed to live in the same Workspace and Artifact.
alter table revisions
  add column if not exists parent_revision_id text;

-- Deferrable like the other composite FKs onto revisions (see 0020): claim
-- reparent rewrites workspace_id across every revision row in one statement, so
-- the self-FK must defer its check to commit or the bulk update transiently
-- violates it.
alter table revisions
  drop constraint if exists revisions_parent_fk,
  add constraint revisions_parent_fk
    foreign key (workspace_id, artifact_id, parent_revision_id)
    references revisions(workspace_id, artifact_id, id)
    on delete set null (parent_revision_id)
    deferrable initially deferred;

create index if not exists revisions_parent_idx
  on revisions(workspace_id, artifact_id, parent_revision_id);

commit;
