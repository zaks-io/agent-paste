begin;

alter table claim_tokens
  add column if not exists public_id text;

create unique index if not exists claim_tokens_public_id_unique
  on claim_tokens(public_id)
  where public_id is not null;

commit;
