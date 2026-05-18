-- Smallville-style memory retrieval.
--
-- Composite score = w_sim*similarity + w_imp*importance + w_rec*recency:
--   similarity  = greatest(0, 1 - (embedding <=> query))  -- pgvector cosine,
--                 clamped to a clean [0, 1]
--   importance  = stored importance / 10
--   recency     = exp(-hours_since_created / 72)
--
-- The three weights are function parameters (default 1.0 each) so they can be
-- tuned at call time without a migration.
--
-- Computed entirely in SQL so we only ship the top_k rows back to the app.
-- Note: ordering by the composite score means the HNSW index is not used
-- (it accelerates pure distance ordering only); this does a scan over the
-- NPC's memories, which is fine at expected volumes (hundreds per NPC).

create or replace function match_memories(
  p_npc_id          text,
  p_query_embedding vector(1536),
  p_top_k           int,
  p_w_similarity    double precision default 1.0,
  p_w_importance    double precision default 1.0,
  p_w_recency       double precision default 1.0
)
returns table (
  id                     uuid,
  npc_id                 text,
  memory_type            text,
  content                text,
  importance             int,
  source_conversation_id uuid,
  in_game_timestamp      timestamptz,
  created_at             timestamptz,
  similarity             double precision,
  importance_norm        double precision,
  recency                double precision,
  composite_score        double precision
)
language sql
stable
as $$
  select
    m.id,
    m.npc_id,
    m.memory_type,
    m.content,
    m.importance,
    m.source_conversation_id,
    m.in_game_timestamp,
    m.created_at,
    greatest(0, 1 - (m.embedding <=> p_query_embedding))::double precision
      as similarity,
    (m.importance::double precision / 10.0)
      as importance_norm,
    exp(
      - (extract(epoch from (now() - m.created_at)) / 3600.0) / 72.0
    )::double precision
      as recency,
    (
      p_w_similarity * greatest(0, 1 - (m.embedding <=> p_query_embedding))
      + p_w_importance * (m.importance::double precision / 10.0)
      + p_w_recency * exp(
          - (extract(epoch from (now() - m.created_at)) / 3600.0) / 72.0
        )
    )::double precision
      as composite_score
  from memory_stream m
  where m.npc_id = p_npc_id
    and m.embedding is not null
  order by composite_score desc
  limit p_top_k;
$$;
