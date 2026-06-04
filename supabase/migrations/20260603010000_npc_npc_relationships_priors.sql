-- Immutable snapshot of the seeded NPC↔NPC relationship priors, so a per-player
-- game reset (scripts/reset-game.ts) can restore npc_npc_relationships to its
-- starting state after off-screen inter-NPC events have mutated it.
--
-- The snapshot is bootstrapped from data/npc_relationships.ts (the canonical
-- prior source) on the first reset — NOT from the live npc_npc_relationships
-- table, which drifts as events release.
create table if not exists npc_npc_relationships_priors (
  npc_a_id                 text not null references npcs (id) on delete cascade,
  npc_b_id                 text not null references npcs (id) on delete cascade,
  trust                    real not null default 0.5,
  respect                  real not null default 0.5,
  vibe                     real not null default 0.5,
  archetype_affinity_prior real not null default 0.0,
  primary key (npc_a_id, npc_b_id)
);

comment on table npc_npc_relationships_priors is
  'Immutable snapshot of the seeded NPC↔NPC relationship priors. scripts/reset-game.ts restores npc_npc_relationships from here after a reset; bootstrapped from data/npc_relationships.ts on first reset.';
