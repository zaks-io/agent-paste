drop index if exists operation_events_workspace_occurred_idx;

create index if not exists operation_events_workspace_occurred_id_idx
  on operation_events(workspace_id, occurred_at desc nulls last, id desc nulls last);
