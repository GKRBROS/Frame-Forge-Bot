
-- ============ EXTENSIONS ============
create extension if not exists pg_trgm;

-- ============ ROLES ============
create type public.app_role as enum ('admin', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null default 'user',
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "users can read own roles" on public.user_roles for select using (auth.uid() = user_id);
create policy "admins read all roles" on public.user_roles for select using (public.has_role(auth.uid(), 'admin'));
create policy "admins manage roles" on public.user_roles for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles readable by authed" on public.profiles for select to authenticated using (true);
create policy "users update own profile" on public.profiles for update using (auth.uid() = user_id);
create policy "users insert own profile" on public.profiles for insert with check (auth.uid() = user_id);

-- ============ TIMESTAMPS TRIGGER ============
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ============ NEW USER HOOK ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ DOCUMENTS ============
create type public.doc_status as enum ('pending', 'processing', 'ready', 'failed', 'disabled');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_type text not null default 'upload',
  file_path text,
  mime_type text,
  byte_size bigint default 0,
  status doc_status not null default 'pending',
  chunk_count integer not null default 0,
  collection text default 'default',
  enabled boolean not null default true,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.documents enable row level security;
create index documents_user_idx on public.documents(user_id);

create policy "users see own documents" on public.documents for select using (auth.uid() = user_id);
create policy "admins see all documents" on public.documents for select using (public.has_role(auth.uid(), 'admin'));
create policy "users insert own documents" on public.documents for insert with check (auth.uid() = user_id);
create policy "users update own documents" on public.documents for update using (auth.uid() = user_id);
create policy "admins update any documents" on public.documents for update using (public.has_role(auth.uid(), 'admin'));
create policy "users delete own documents" on public.documents for delete using (auth.uid() = user_id);
create policy "admins delete any documents" on public.documents for delete using (public.has_role(auth.uid(), 'admin'));

create trigger trg_documents_updated before update on public.documents
  for each row execute function public.touch_updated_at();

-- ============ CHUNKS ============
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  tokens integer default 0,
  tsv tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now()
);
alter table public.chunks enable row level security;
create index chunks_doc_idx on public.chunks(document_id);
create index chunks_user_idx on public.chunks(user_id);
create index chunks_tsv_idx on public.chunks using gin(tsv);
create index chunks_trgm_idx on public.chunks using gin(content gin_trgm_ops);

create policy "users see own chunks" on public.chunks for select using (auth.uid() = user_id);
create policy "admins see all chunks" on public.chunks for select using (public.has_role(auth.uid(), 'admin'));
create policy "users insert own chunks" on public.chunks for insert with check (auth.uid() = user_id);
create policy "users delete own chunks" on public.chunks for delete using (auth.uid() = user_id);
create policy "admins delete chunks" on public.chunks for delete using (public.has_role(auth.uid(), 'admin'));

-- ============ CONVERSATIONS / MESSAGES ============
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.conversations enable row level security;
create index conv_user_idx on public.conversations(user_id);
create policy "users own conversations all" on public.conversations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger trg_conv_updated before update on public.conversations
  for each row execute function public.touch_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  citations jsonb default '[]'::jsonb,
  confidence numeric default null,
  rejected boolean default false,
  model text,
  tokens_in integer default 0,
  tokens_out integer default 0,
  latency_ms integer default 0,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index msg_conv_idx on public.messages(conversation_id);
create policy "users own messages all" on public.messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ AI SETTINGS (single global row) ============
create table public.ai_settings (
  id integer primary key default 1,
  active_model text not null default 'deepseek/deepseek-chat-v3.1',
  fallback_model text default 'qwen/qwen3-32b',
  temperature numeric not null default 0.2,
  max_tokens integer not null default 1024,
  confidence_threshold numeric not null default 0.15,
  strict_knowledge boolean not null default true,
  allow_internet boolean not null default false,
  allow_web_scraping boolean not null default false,
  enable_ocr boolean not null default true,
  hallucination_prevention boolean not null default true,
  out_of_scope_rejection boolean not null default true,
  image_extraction boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);
alter table public.ai_settings enable row level security;
create policy "ai settings readable" on public.ai_settings for select to authenticated using (true);
create policy "admins update ai settings" on public.ai_settings for update using (public.has_role(auth.uid(), 'admin'));
create policy "admins insert ai settings" on public.ai_settings for insert with check (public.has_role(auth.uid(), 'admin'));
create trigger trg_ai_settings_updated before update on public.ai_settings
  for each row execute function public.touch_updated_at();

insert into public.ai_settings (id) values (1) on conflict do nothing;

-- ============ QUERY LOGS (analytics) ============
create table public.query_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  question text not null,
  confidence numeric default 0,
  rejected boolean not null default false,
  model text,
  tokens_in integer default 0,
  tokens_out integer default 0,
  latency_ms integer default 0,
  created_at timestamptz not null default now()
);
alter table public.query_logs enable row level security;
create index ql_user_idx on public.query_logs(user_id);
create index ql_created_idx on public.query_logs(created_at desc);
create policy "users see own logs" on public.query_logs for select using (auth.uid() = user_id);
create policy "admins see all logs" on public.query_logs for select using (public.has_role(auth.uid(), 'admin'));
create policy "users insert own logs" on public.query_logs for insert with check (auth.uid() = user_id);

-- ============ STORAGE BUCKET ============
insert into storage.buckets (id, name, public) values ('knowledge-documents', 'knowledge-documents', false)
  on conflict (id) do nothing;

create policy "users read own docs" on storage.objects for select
  using (bucket_id = 'knowledge-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "admins read all docs" on storage.objects for select
  using (bucket_id = 'knowledge-documents' and public.has_role(auth.uid(), 'admin'));
create policy "users upload own docs" on storage.objects for insert
  with check (bucket_id = 'knowledge-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "users delete own docs" on storage.objects for delete
  using (bucket_id = 'knowledge-documents' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============ HYBRID SEARCH RPC ============
create or replace function public.search_chunks(
  _user_id uuid,
  _query text,
  _limit integer default 8
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  content text,
  score real
)
language sql stable security definer set search_path = public as $$
  with q as (select websearch_to_tsquery('english', _query) as tsq, _query as raw)
  select
    c.id as chunk_id,
    c.document_id,
    d.title as document_title,
    c.content,
    (
      coalesce(ts_rank_cd(c.tsv, q.tsq), 0) * 2.0
      + coalesce(similarity(c.content, q.raw), 0) * 0.5
    )::real as score
  from public.chunks c
  join public.documents d on d.id = c.document_id
  cross join q
  where d.enabled = true
    and d.status = 'ready'
    and (d.user_id = _user_id or public.has_role(_user_id, 'admin'))
    and (c.tsv @@ q.tsq or c.content % q.raw)
  order by score desc
  limit _limit;
$$;
