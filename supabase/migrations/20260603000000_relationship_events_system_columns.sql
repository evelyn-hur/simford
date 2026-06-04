-- Let relationship_events also record SYSTEM-driven (NPC↔NPC) relationship
-- changes, not just player↔NPC ones. A system row has player_id = NULL, the
-- two NPCs of the pair in (npc_id, npc_b_id), and a link back to the
-- inter_npc_event that caused it. Player rows leave both new columns NULL, so
-- existing behavior is unchanged.
alter table relationship_events
  add column if not exists npc_b_id text references npcs (id) on delete cascade;

alter table relationship_events
  add column if not exists inter_npc_event_id uuid
    references inter_npc_events (id) on delete set null;

comment on column relationship_events.npc_b_id is
  'For system (NPC↔NPC) changes: the second NPC of the pair (npc_id is the first). NULL for player↔NPC rows.';
comment on column relationship_events.inter_npc_event_id is
  'For system changes: the inter_npc_event that caused this relationship shift. NULL for player↔NPC rows.';

-- Speeds up the "recent system changes" feed and the timeline reconstruction,
-- which both filter on player_id IS NULL ordered by recency.
create index if not exists relationship_events_system_idx
  on relationship_events (created_at desc)
  where player_id is null;
