-- Condensed values summary for the relationship-judge prompt, so we don't
-- ship the full identity_prompt / values_json on every judge call.
alter table npcs add column if not exists judge_summary text;

comment on column npcs.judge_summary is
  'Condensed 2-3 sentence values summary used in the relationship-judge prompt instead of the full identity/values_json.';
