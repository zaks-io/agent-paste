begin;

create index if not exists operation_events_occurred_id_idx
  on operation_events(occurred_at desc nulls last, id desc nulls last);

commit;
