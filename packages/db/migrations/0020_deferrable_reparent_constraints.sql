begin;

-- Claim reparent updates workspace_id across composite-FK child rows in one command.
-- Defer those checks until commit so artifacts/revisions can move before access_links
-- and safety_warnings are re-stamped.
alter table access_links
  drop constraint access_links_artifact_fk,
  add constraint access_links_artifact_fk
    foreign key (workspace_id, artifact_id)
    references artifacts(workspace_id, id) on delete cascade
    deferrable initially deferred;

alter table access_links
  drop constraint access_links_revision_fk,
  add constraint access_links_revision_fk
    foreign key (workspace_id, artifact_id, revision_id)
    references revisions(workspace_id, artifact_id, id) on delete cascade
    deferrable initially deferred;

alter table safety_warnings
  drop constraint safety_warnings_revision_fk,
  add constraint safety_warnings_revision_fk
    foreign key (workspace_id, artifact_id, revision_id)
    references revisions(workspace_id, artifact_id, id) on delete cascade
    deferrable initially deferred;

commit;
