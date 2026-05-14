alter table public.query_logs
  add column if not exists event_type text not null default 'question';

alter table public.query_logs
  add column if not exists event_label text;

alter table public.query_logs
  add column if not exists metadata jsonb not null default '{}'::jsonb;