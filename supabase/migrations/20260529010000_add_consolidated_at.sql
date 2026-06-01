-- Marks an episodic memory as folded into a semantic memory by consolidation.
-- Null = not yet consolidated. Consolidated memories are NOT deleted; they just
-- rank lower in retrieval (semantic memories carry a small bonus instead).
alter table memory_stream add column if not exists consolidated_at timestamptz;

comment on column memory_stream.consolidated_at is
  'When this episodic memory was folded into a semantic memory by consolidation. Null = not yet consolidated.';

-- Hot path: fetch unconsolidated episodic memories for an NPC.
create index if not exists memory_stream_unconsolidated_episodic_idx
  on memory_stream (npc_id)
  where memory_type = 'episodic' and consolidated_at is null;
