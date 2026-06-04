# Evaluation Scenarios

Twenty scripted scenarios that operationalize the four dimensions in
[`../PLAN.md`](../PLAN.md). Each is a self-contained YAML file describing a
sequence of player actions, a probe, the behavior we expect, and how to grade it.
Together they cover the full 12-NPC roster and a deliberate spread of topics so no
single dimension is tested on one narrow slice of the game.

The PLAN defines _what_ each dimension measures and the success thresholds; these
files are the _concrete inputs_ that produce those measurements.

## Distribution

| Dimension | Count | Files |
|---|---|---|
| Memory consistency | 6 | `mem-01` … `mem-06` |
| Relationship validity | 6 | `rel-01` … `rel-06` |
| Cultural authenticity | 4 | `cul-01` … `cul-04` |
| Inter-NPC coherence | 4 | `inter-01` … `inter-04` |

## Catalog

### Memory consistency — `PLAN.md §2`
Topics span vulnerability, intellectual exchange, ambition, gossip, and hobby —
intentionally **not** all academic stress — plus a confabulation negative control.

| ID | NPC | Topic | What it tests | Method |
|---|---|---|---|---|
| `mem-01-family-pressure-secret` | Alex | First-gen family pressure / music | Vulnerable disclosure survives consolidation; no fabrication | `llm_judge` |
| `mem-02-research-topic-recall` | Priya | GNNs for protein binding | Technical-content recall; identity-keyword boost | `keyword_match` |
| `mem-03-startup-idea-recall` | Jake | "Stacks" textbook marketplace | Recall a named goal/ambition | `keyword_match` |
| `mem-04-social-gossip-recall` | DJ | Secret relationship w/ a swimmer | Low-salience social fact recall | `keyword_match` |
| `mem-05-hobby-recall-across-gap` | Ben | Restoring a Juno-60 synth | Mid-importance recall across a 3-day gap (recency decay) | `keyword_match` |
| `mem-06-confabulation-guard` | Theo | (never stated a major) | Negative control: graceful non-recall, no fabrication | `llm_judge` |

### Relationship validity — `PLAN.md §3`
`rel-02` and `rel-03` are a **value-sensitivity pair**: the same player message
(`pair_id: value-sensitivity-builder`) sent to Priya vs. Jake — it must move their
scores in opposite directions.

| ID | NPC | Scenario | Expected (T / R / V) | Method |
|---|---|---|---|---|
| `rel-01-substantive-pushback-priya` | Priya | Correct, humble methodological critique | ↑/⬆/↑ | `relationship_delta_direction` |
| `rel-02-hype-namedrop-priya` | Priya | YC/TAM hype + "pick your brain" (pair A) | ↓/↓/⬇ | `relationship_delta_direction` |
| `rel-03-builder-pitch-jake` | Jake | Same pitch, rewarded as building (pair B) | ↑/⬆/⬆ | `relationship_delta_direction` |
| `rel-04-neutral-smalltalk-sasha` | Sasha | Dining hours + weather (anti-drift) | 0 / 0 / 0 | `relationship_delta_direction` |
| `rel-05-brilliant-but-cutting-maya` | Maya | Valid catch, but publicly belittling | ⬇/↑/⬇ (independence) | `relationship_delta_direction` |
| `rel-06-being-seen-dj` | DJ | Seen as a mind, struggle de-stigmatized | ⬆/↑/↑ (trust path) | `relationship_delta_direction` |

_(⬆/⬇ = the headline dimension for that scenario.)_

### Cultural authenticity — `PLAN.md §4`

| ID | NPC | What it tests | Method |
|---|---|---|---|
| `cul-01-authenticity-marcus` | Marcus | Authenticity / voice-fidelity / absence-of-tells Likert | `human_rated` |
| `cul-02-register-discrimination-june` | June | "Voice Turing test" — can a blind rater pick her out of 12? | `human_rated` |
| `cul-03-format-and-negative-marker-eliza` | Eliza | No asterisks / metadata / therapyspeak under a vulnerability prompt | `llm_judge` |
| `cul-04-caricature-check-jake` | Jake | Person vs. startup-bro parody when pressed | `human_rated` |

### Inter-NPC coherence — `PLAN.md §5`
These drive state by `advance_days` (which **releases** off-screen events) and then
inspect or probe. **Unlike the other three dimensions, these are grounded in the
actual seeded `inter_npc_events`** — every file carries a `seeded_events` block
listing the real rows it depends on (pair, day, gist, deltas). The grounding was
read directly from the generated table (132 rows) and is stable across
`reset-game.ts` (which only flips `processed=false`); it only changes if
`scripts/generate-inter-npc-events.ts --reset` is re-run, in which case the
`seeded_events` blocks must be re-derived.

| ID | Pair | Seeded arc → what it tests | Method |
|---|---|---|---|
| `inter-01-canon-plausibility-ben-priya` | Ben ↔ Priya | 2 warm events (medium band) → canon-plausible, stays high | `llm_judge` |
| `inter-02-cold-pair-no-warm-drift-jake-priya` | Jake ↔ Priya | 3 events → **respect-led** grudging thaw, not warmth | `relationship_delta_direction` |
| `inter-03-cross-reference-consistency-eliza-june` | Eliza ↔ June | 4 events (only days 2 & 5 released at day 7) → consistent, unresolved friction | `llm_judge` |
| `inter-04-information-boundary-riya-sasha` | Riya / Sasha | day-2 event released → Sasha knows Riya, not the player's secret | `llm_judge` |

> **Band vs. count vs. tone.** Event *count* is set by `archetype_affinity_prior`,
> which is **cluster-based** (cutoff strict: `> 0.70` high → 4–6; `0.40–0.70`
> medium → 2–3; `< 0.40` low → 0–1). A pair's *coldness* lives separately, in its
> trust/respect/vibe priors and canon `notes`, which steer event tone and deltas.
> So `jake↔priya` (tech·tech, affinity 0.70) is a **medium**-band pair that gets
> 2–3 events whose *tone* is cool — not a low-count pair.

## Coverage

- **All 12 NPCs appear:** Alex, Ben, DJ, Eliza, Jake, June, Marcus, Maya, Priya,
  Riya, Sasha, Theo.
- **Topic diversity (memory):** vulnerability, technical/intellectual, ambition,
  social gossip, hobby, and a no-fabrication control — no two memory scenarios share
  a topic.
- **Method diversity:** all four `evaluation_method`s are exercised; the relationship
  dimension leans on the deterministic `relationship_delta_direction` check, the
  subjective parts of cultural authenticity use `human_rated`.
- **Both poles of each axis:** relationships test scores going up, down, AND staying
  flat; inter-NPC tests both a warm pair and a cold pair.

### Evaluated at the dataset level (not as scenarios)
Two PLAN methods are aggregate properties of the generated world rather than single
scripted runs, so they are computed over the whole dataset instead of as YAML files
here:
- **Affinity ↔ activity correlation** (`PLAN.md §5`): correlate each of the 66 pairs'
  `archetype_affinity_prior` against its realized inter-NPC event count. (The table is
  currently populated with 132 events across 56 event-bearing pairs, so this is
  computable now; the band-to-count mapping above held in spot checks — e.g. the
  hum·hum 0.75 pair `eliza↔june` has 4 events, the 0.70 tech·tech pairs have 2–3.)
- **Network face validity** (`PLAN.md §5`): show raters the day-14 `/network` graph
  and top cofounder pairs and ask whether the structure "looks right."

## Schema

Every scenario file uses the following shape. Fields marked _(opt)_ are optional.

```yaml
id: <kebab-case-id>                      # unique, prefixed by dimension
dimension: memory_consistency | relationship_validity
         | cultural_authenticity | inter_npc_coherence
title: <one-line human title>            # (opt)
npc: <npc_id>                            # single-NPC scenarios
npcs: [<npc_id>, <npc_id>]               # cross-NPC scenarios (use instead of npc)
tags: [<tag>, ...]                       # (opt)
plan_ref: "PLAN.md §N — ..."             # (opt) which PLAN methodology this serves
pair_id: <id>                            # (opt) links a value-sensitivity pair

setup:                                   # ordered list of steps (see vocabulary)
  - player: "<message text>"
    to: <npc_id>                         # (opt) target NPC when multiple are involved
  - end_conversation: true               # or:  end_conversation: <npc_id>
  - advance_days: <N>

probe:                                   # the test query
  to: <npc_id> | [<npc_id>, ...]         # (opt) default = scenario npc; list = ask each
  query: "<question text>"

expected_behavior: "<what should happen, in prose>"
evaluation_method: keyword_match | llm_judge | human_rated | relationship_delta_direction
pass_threshold: "<the success condition, ideally tied to a PLAN threshold>"   # (opt)
notes: "<rationale, caveats>"            # (opt)

# inter_npc_coherence ONLY — the actual seeded events this scenario depends on:
seeded_events:                           # (opt) list of real rows from inter_npc_events
  - "day <N> — <type> @ <location>: <gist>. Δ trust ±x / respect ±y / vibe ±z"
seeded_events_net: "<sum of deltas / one-line characterization of the arc>"   # (opt)
seeded_events_note: "<which events release by the scenario's advance_days, caveats>"  # (opt)

# --- method-specific fields ---
```

> **`seeded_events`** is what makes the inter-NPC scenarios _grounded_ rather than
> assumed: each lists the concrete `inter_npc_events` rows (read from the DB) that
> the scenario's `advance_days` will release, so `expected_behavior` and
> `pass_threshold` describe the **real** arc, not a guess. The other three
> dimensions don't use it — they don't depend on the off-screen event system.

### Step vocabulary (`setup`)
- `player: "<text>"` — player sends a message to the scenario's NPC (or to `to:` if set).
- `end_conversation: true` — end + judge the current conversation. `end_conversation: <npc_id>`
  ends a specific NPC's conversation in a cross-NPC scenario.
- `advance_days: <N>` — advance the in-game clock so the current in-game day becomes **`N`**,
  measured from the **day-1 baseline** a fresh `reset-game.ts` establishes (i.e. it is a
  *target day*, not a relative "+N"). This triggers memory **consolidation** and **releases**
  every unprocessed inter-NPC event with **`in_game_day ≤ N`** (the catch-up semantics in
  `lib/events.ts`).
  - Implementation note: `advanceInGameDay` increments the clock **by 1 per call**, so a
    runner reaches day `N` by calling `/api/advance-day` until the clock reads `N` — do **not**
    call it `N` times from day 1 (that would overshoot to day `N+1`). This boundary is load-bearing:
    `inter-03` uses `advance_days: 7` precisely so the eliza↔june day-8 reconciliation is *not*
    yet released and the pair is probed mid-friction. Releasing day 8 would invalidate the test.

### Method-specific fields

| `evaluation_method` | Fields |
|---|---|
| `keyword_match` | `keywords: [...]`, `keyword_match_mode: any \| all` (default `any`), `forbidden_keywords: [...]` _(opt)_ |
| `llm_judge` | `judge_rubric: "<instructions to the grader>"`, `judge_labels: [...]` _(opt classification labels)_ |
| `human_rated` | `rating_dimensions: ["<scale (1-5): question>", ...]`, `rater_instructions: "..."` |
| `relationship_delta_direction` | `expected_delta_directions: {trust, respect, vibe}`, `delta_target: player_npc \| npc_npc` (default `player_npc`) |

For `relationship_delta_direction`, the "probe" is **not** a chat message — it is the
relationship delta the judge produces when the conversation is ended (or, for
`delta_target: npc_npc`, the drift of the `npc_npc_relationships` row after
`advance_days` releases events). The `query` field is a placeholder note in those files.

### `expected_delta_directions` vocabulary
Each of `trust` / `respect` / `vibe` takes one of:

- `up` — should clearly increase
- `down` — should clearly decrease
- `neutral` — should not move (|delta| ≤ 0.02)
- `up_or_neutral` — may rise, must not fall
- `down_or_neutral` — may fall, must not rise

## How a runner would execute a scenario
A scenario runner (not included here) would, per file:
1. `reset-game.ts` to a clean per-player baseline (see `PLAN.md §1`).
2. Replay `setup` against the app's APIs: `player` → `/api/chat`;
   `end_conversation` → `/api/conversation/end`; `advance_days` → `/api/advance-day`.
3. Issue the `probe` (chat message, or read relationship/event state for the
   delta/inspection methods).
4. Apply `evaluation_method` and compare to `pass_threshold`.

Because chat runs at temperature 0.5 and judging is stochastic, each scenario should
be run over multiple seeds and reported with variance — see the limitations in
`PLAN.md §6`.
