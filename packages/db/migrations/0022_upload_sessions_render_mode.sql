begin;

-- Explicit client-requested render mode for an upload session. Null (all
-- pre-existing rows) means the server infers the mode from the entrypoint
-- extension at finalize, exactly as before.
alter table upload_sessions
  add column if not exists render_mode text
    check (render_mode is null or render_mode in ('html', 'markdown', 'text', 'image', 'audio', 'video'));

commit;
