-- Topics an NPC cares about, used for post-DB identity-relevance re-ranking
-- (done in TypeScript, not in match_memories). Substring-matched against memory
-- content to nudge identity-relevant memories up in retrieval.
alter table npcs
  add column if not exists identity_keywords text[] not null default '{}';

comment on column npcs.identity_keywords is
  'Lowercase-matched topic keywords for identity-relevance re-ranking of retrieved memories.';
