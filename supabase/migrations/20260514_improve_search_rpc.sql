-- ============ IMPROVED HYBRID SEARCH RPC FOR EDUCATIONAL QUERIES ============
-- This version is more lenient for educational content and short queries

create or replace function public.search_chunks(
  _user_id uuid,
  _query text,
  _limit integer default 12
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  content text,
  score real
)
language sql stable security definer set search_path = public as $$
  with q as (
    select 
      websearch_to_tsquery('english', _query) as tsq,
      plainto_tsquery('english', _query) as plain_tsq,
      _query as raw,
      CASE 
        WHEN length(_query) < 15 THEN 0.35  -- short queries (keywords): lower threshold
        ELSE 0.20  -- longer queries: slightly higher threshold
      END as min_score_threshold
  ),
  scored_chunks as (
    select
      c.id as chunk_id,
      c.document_id,
      d.title as document_title,
      c.content,
      (
        -- Full-text search on websearch tokens (2.0x weight)
        coalesce(ts_rank_cd(c.tsv, q.tsq, 2), 0) * 2.0 +
        -- Full-text search on plain tokens (1.5x weight) - more lenient
        coalesce(ts_rank_cd(c.tsv, q.plain_tsq, 2), 0) * 1.5 +
        -- Trigram similarity for keyword matching (1.0x weight)
        coalesce(similarity(c.content, q.raw), 0) * 1.0 +
        -- Direct token presence boost for short educational queries
        CASE
          WHEN exists (
            select 1
            from unnest(string_to_array(lower(q.raw), ' ')) as kw(token)
            where length(kw.token) > 2
              and c.content ilike '%' || kw.token || '%'
          ) then 0.3
          else 0
        end
      )::real as score
    from public.chunks c
    join public.documents d on d.id = c.document_id
    cross join q
    where d.enabled = true
      and d.status = 'ready'
      and (d.user_id = _user_id or public.has_role(_user_id, 'admin'))
      -- More lenient matching: ANY of the following conditions
      and (
        c.tsv @@ q.tsq                      -- websearch full-text match
        or c.tsv @@ q.plain_tsq             -- plain full-text match (fallback)
        or c.content % q.raw                 -- trigram similarity
        or c.content ILIKE '%' || split_part(_query, ' ', 1) || '%'  -- first token match
      )
  )
  select
    chunk_id,
    document_id,
    document_title,
    content,
    score
  from scored_chunks
  where score > 0
  order by score desc
  limit _limit;
$$;

-- ============ KEYWORD SEARCH RPC FOR FALLBACK RETRIEVAL ============
-- Purely keyword-based, no semantics, for maximum catch
create or replace function public.search_chunks_keyword(
  _user_id uuid,
  _keywords text[],
  _limit integer default 12
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  content text,
  score real
)
language sql stable security definer set search_path = public as $$
  with kw as (
    select unnest(coalesce(_keywords, array[]::text[])) as token
  )
  select
    c.id as chunk_id,
    c.document_id,
    d.title as document_title,
    c.content,
    (
      count(*) filter (
        where c.content ilike '%' || kw.token || '%'
      )::real / greatest(cardinality(coalesce(_keywords, array[]::text[])), 1)
    ) * 100::real as score
  from public.chunks c
  join public.documents d on d.id = c.document_id
  cross join kw
  where d.enabled = true
    and d.status = 'ready'
    and (d.user_id = _user_id or public.has_role(_user_id, 'admin'))
    and c.content ilike '%' || kw.token || '%'
  group by c.id, c.document_id, d.title, c.content
  order by score desc
  limit _limit;
$$;
