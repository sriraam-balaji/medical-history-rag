alter table public.documents
  add column if not exists retry_count integer not null default 0;

alter table public.documents
  add constraint documents_retry_count_nonnegative check (retry_count >= 0);
