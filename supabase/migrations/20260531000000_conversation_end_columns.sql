-- Track when a conversation is explicitly ended and whether the
-- relationship judge has already been run for it. Together these enable
-- a per-session (instead of per-turn) judging flow.
alter table conversations
  add column if not exists ended_at timestamptz;

alter table conversations
  add column if not exists judged boolean not null default false;

comment on column conversations.ended_at is
  'When the conversation was explicitly ended by the player. Null = still ongoing.';
comment on column conversations.judged is
  'True once the relationship judge has been run for this conversation. Prevents double-judging.';
