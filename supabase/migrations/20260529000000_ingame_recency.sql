-- Recency now decays over IN-GAME time, not real-world time. The caller passes
-- p_now_in_game = the player's current in-game timestamp (quarter start +
-- in_game_day days); recency is measured against each memory's
-- in_game_timestamp. This way, playing across multiple real days doesn't fade
-- memories when no in-game time has passed.

-- Backfill memories written before in_game_timestamp was populated, treating
-- them as in-game day 1 (matches inGameTimestampForDay(1) in lib/gameTime.ts).
update memory_stream
set in_game_timestamp = timestamptz '2025-09-23 00:00:00+00'
where in_game_timestamp is null;

-- Signature changes (new parameter), so drop the old function first.
drop function if exists match_memories(
  text, vector, integer, double precision, double precision, double precision
);

create or replace function match_memories(
  p_npc_id          text,
  p_query_embedding vector(1536),
  p_top_k           int,
  p_w_similarity    double precision default 1.0,
  p_w_importance    double precision default 1.0,
  p_w_recency       double precision default 1.0,
  p_now_in_game     timestamptz default now()
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
      - greatest(
          0,
          extract(
            epoch from (
              p_now_in_game - coalesce(m.in_game_timestamp, p_now_in_game)
            )
          )
        ) / 3600.0 / 72.0
    )::double precision
      as recency,
    (
      p_w_similarity * greatest(0, 1 - (m.embedding <=> p_query_embedding))
      + p_w_importance * (m.importance::double precision / 10.0)
      + p_w_recency * exp(
          - greatest(
              0,
              extract(
                epoch from (
                  p_now_in_game - coalesce(m.in_game_timestamp, p_now_in_game)
                )
              )
            ) / 3600.0 / 72.0
        )
    )::double precision
      as composite_score
  from memory_stream m
  where m.npc_id = p_npc_id
    and m.embedding is not null
  order by composite_score desc
  limit p_top_k;
$$;
