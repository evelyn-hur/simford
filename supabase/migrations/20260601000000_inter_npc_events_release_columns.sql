-- Enrich inter_npc_events so off-screen NPC-NPC events can be "released"
-- gradually: each event records where it happened, the relationship deltas
-- it applies, whether it has been processed yet, and a derived archetype-pair
-- key for analytics.
alter table inter_npc_events
  add column if not exists location text;

alter table inter_npc_events
  add column if not exists relationship_deltas jsonb;

alter table inter_npc_events
  add column if not exists processed boolean not null default false;

alter table inter_npc_events
  add column if not exists archetype_pair_key text;

comment on column inter_npc_events.location is
  'Where the event happened, e.g. "Coupa Cafe", "Huang lobby", "the Oval".';
comment on column inter_npc_events.relationship_deltas is
  'Deltas this event applies to the NPC-NPC relationship, e.g. { "trust": 0.02, "respect": -0.01, "vibe": 0.03 }.';
comment on column inter_npc_events.processed is
  'True once the event has been released: memories written and relationship state updated. Prevents double-processing.';
comment on column inter_npc_events.archetype_pair_key is
  'Derived archetype pair for analytics, e.g. "tech-tech" or "tech-humanities".';

-- Speeds up the "find unreleased events" query in the release loop.
create index if not exists inter_npc_events_processed_idx
  on inter_npc_events (processed)
  where processed = false;
