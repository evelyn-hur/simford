-- Initial schema for stanford-society
-- Embeddings are 1536-dimensional (OpenAI text-embedding-3-small).

-- Required for vector(1536) columns and the HNSW similarity index.
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- npcs
-- ---------------------------------------------------------------------------
create table npcs (
  id              text primary key,
  name            text not null,
  archetype       text not null,
  identity_prompt text not null,
  speaking_style  text not null,
  values_json     jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------
create table players (
  id           uuid primary key default auth.uid(),
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create table conversations (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references players (id) on delete cascade,
  npc_id     text not null references npcs (id) on delete cascade,
  started_at timestamptz not null default now()
);

create index conversations_player_id_idx on conversations (player_id);
create index conversations_npc_id_idx on conversations (npc_id);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  role            text not null check (role in ('player', 'npc')),
  content         text not null,
  tokens_in       integer,
  tokens_out      integer,
  created_at      timestamptz not null default now()
);

create index messages_conversation_id_created_at_idx
  on messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- memory_stream
-- ---------------------------------------------------------------------------
create table memory_stream (
  id                   uuid primary key default gen_random_uuid(),
  npc_id               text not null references npcs (id) on delete cascade,
  memory_type          text not null
                         check (memory_type in ('episodic', 'semantic', 'reflection')),
  content              text not null,
  importance           integer not null check (importance between 1 and 10),
  embedding            vector(1536),
  source_conversation_id uuid references conversations (id) on delete set null,
  in_game_timestamp    timestamptz,
  created_at           timestamptz not null default now()
);

create index memory_stream_npc_id_idx on memory_stream (npc_id);
create index memory_stream_npc_id_type_idx on memory_stream (npc_id, memory_type);

-- Approximate nearest-neighbour index for cosine similarity search.
-- HNSW: better recall/latency than IVFFlat and no training step required.
create index memory_stream_embedding_hnsw_idx
  on memory_stream
  using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- player_npc_relationships
-- ---------------------------------------------------------------------------
create table player_npc_relationships (
  player_id    uuid not null references players (id) on delete cascade,
  npc_id       text not null references npcs (id) on delete cascade,
  trust        real not null default 0.5,
  respect      real not null default 0.5,
  vibe         real not null default 0.5,
  last_updated timestamptz not null default now(),
  primary key (player_id, npc_id)
);

create index player_npc_relationships_npc_id_idx
  on player_npc_relationships (npc_id);

-- ---------------------------------------------------------------------------
-- npc_npc_relationships
-- ---------------------------------------------------------------------------
create table npc_npc_relationships (
  npc_a_id                text not null references npcs (id) on delete cascade,
  npc_b_id                text not null references npcs (id) on delete cascade,
  trust                   real not null default 0.5,
  respect                 real not null default 0.5,
  vibe                    real not null default 0.5,
  archetype_affinity_prior real not null default 0.0,
  last_updated            timestamptz not null default now(),
  primary key (npc_a_id, npc_b_id)
);

create index npc_npc_relationships_npc_b_id_idx
  on npc_npc_relationships (npc_b_id);

-- ---------------------------------------------------------------------------
-- relationship_events
-- ---------------------------------------------------------------------------
create table relationship_events (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid references players (id) on delete set null,
  npc_id          text not null references npcs (id) on delete cascade,
  delta_trust     real not null default 0.0,
  delta_respect   real not null default 0.0,
  delta_vibe      real not null default 0.0,
  reasoning       text,
  conversation_id uuid references conversations (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index relationship_events_npc_id_idx on relationship_events (npc_id);
create index relationship_events_player_id_idx on relationship_events (player_id);
create index relationship_events_conversation_id_idx
  on relationship_events (conversation_id);

-- ---------------------------------------------------------------------------
-- inter_npc_events
-- ---------------------------------------------------------------------------
create table inter_npc_events (
  id                uuid primary key default gen_random_uuid(),
  npc_a_id          text not null references npcs (id) on delete cascade,
  npc_b_id          text not null references npcs (id) on delete cascade,
  event_type        text not null,
  content           text not null,
  in_game_timestamp timestamptz,
  created_at        timestamptz not null default now()
);

create index inter_npc_events_npc_a_id_idx on inter_npc_events (npc_a_id);
create index inter_npc_events_npc_b_id_idx on inter_npc_events (npc_b_id);

-- ---------------------------------------------------------------------------
-- game_state
-- ---------------------------------------------------------------------------
create table game_state (
  player_id        uuid primary key references players (id) on delete cascade,
  in_game_day      integer not null default 1,
  last_advanced_at timestamptz not null default now()
);
