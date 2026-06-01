-- Stamp each message with the in-game day it was sent on, so the chat prompt
-- can annotate the conversation history with in-game time (otherwise the NPC
-- has no signal and ends up saying "an hour ago" when in-game days have
-- actually passed). Nullable for back-compat with existing rows.
alter table messages add column if not exists in_game_day integer;

comment on column messages.in_game_day is
  'In-game day the message was sent on (from game_state at insert time).';
