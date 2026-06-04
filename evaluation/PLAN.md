# Stanford Society — Evaluation Plan

> Evaluating an LLM-driven social simulation: 12 hand-authored Stanford NPCs with
> per-character memory, evolving trust/respect/vibe relationships, and an
> off-screen social world that drifts between play sessions.
> _(Codebase / dev name: "Simford".)_

## 1. What we are evaluating, and why these four dimensions

Stanford Society is not a system with a single correct output, so a single
accuracy number cannot capture whether it "works." Its value is distributed
across four claims the design implicitly makes:

1. NPCs **remember** the player accurately across conversations and in-game days.
2. Relationships **change in ways a human would agree with**, calibrated in size.
3. NPCs **sound like real, specific Stanford people**, not generic chatbots.
4. The **off-screen world stays internally consistent** as it evolves.

Each dimension below gives (1) a definition, (2) a concrete testing methodology
grounded in the actual implementation, (3) the headline metric, and (4) the
threshold or comparison that defines success. We deliberately mix three method
types — **automated** (deterministic checks over logged state), **LLM-as-judge**
(scaled grading of fluent text), and **human rating** (the irreducibly
subjective parts) — and, wherever possible, define success **relative to an
ablation or baseline** rather than against an absolute number we picked by feel.
A metric that only beats "0.80 because 0.80 sounds good" proves little; a metric
that shows the full system beating its own stripped-down variant proves the
design contributed something.

### Summary

| Dimension | Primary metric(s) | Success threshold | Method |
|---|---|---|---|
| Memory consistency | Retrieval Precision@5 / MRR; fact-recall accuracy %; confabulation rate % | P@5 ≥ 0.80 **and** beats similarity-only by ≥ 0.10; recall ≥ 90%; confabulation ≤ 2% | Automated + LLM-judge |
| Relationship validity | Sign-agreement % vs. human consensus; significance↔\|delta\| correlation ρ | Sign agreement ≥ 85%; ρ ≥ 0.6; beats generic-values ablation | Human + automated |
| Cultural authenticity | Authenticity Likert mean (1–5); register-discrimination accuracy % | Mean ≥ 4.0 (lower CI ≥ 3.5); discrimination ≥ 50% (vs. 8.3% chance); +≥1.0 over stripped-prompt | Human (+ auto proxy) |
| Inter-NPC coherence | Event-plausibility %; affinity↔activity correlation; drift Spearman | Plausibility ≥ 90%; affinity ρ ≥ 0.7; drift ρ ∈ [0.6, 0.95] | LLM-judge + automated |

### Shared evaluation harness

All four dimensions draw on a common substrate:

- **Controlled playthrough corpus.** Scripted and free-play sessions are logged
  to Supabase (`conversations`, `messages`, `memory_stream`,
  `relationship_events`, `inter_npc_events`). `scripts/reset-game.ts` restores a
  clean per-player state from the immutable `npc_npc_relationships_priors`
  snapshot, so every experiment starts from an identical, known baseline and is
  repeatable apart from model stochasticity.
- **Existing component harnesses to extend.** `scripts/eval-retrieval.ts`
  (15-memory fixture × 5 queries × 5 weight configs) and
  `scripts/test-identity-relevance.ts` (keyword word-boundary false-positive
  checks) already exist but currently print results for human eyeballing. The
  plan formalizes them with **labeled gold targets** so they emit scores.
- **Rater pool.** For subjective dimensions: ≥ 2 raters per item, with a written
  rubric; current/recent Stanford students recruited where ground-truth campus
  knowledge matters (cultural authenticity). Inter-rater reliability is computed
  and reported as the ceiling on any human-referenced metric.
- **LLM-judge protocol.** Where an LLM grades output, we (a) prefer a different
  model family from the one under test, (b) calibrate the judge against human
  labels on a held-out subset, and (c) report judge↔human agreement so the
  reader can discount the automated numbers appropriately.

---

## 2. Dimension 1 — Memory Consistency

**1) Definition.** Whether NPCs accurately retain, retrieve, and reuse what the
player has disclosed — across conversation turns and across in-game days — without
forgetting salient facts, contradicting the established record, or *fabricating*
details that were never stated. It spans two layers: the **retrieval mechanism**
(does the right memory surface from `match_memories` + the TS identity re-rank in
`lib/memory.ts`) and the **behavioral outcome** (does the NPC act on what it
should know and never assert something false).

**2) Testing methodology.**

- *(a) Retrieval precision — automated, offline.* Extend
  `scripts/eval-retrieval.ts` into a labeled benchmark: for each probe query,
  annotate the gold memory/memories that *should* rank in the top-k among a pool
  of distractors. Run `retrieveMemories()` with each NPC's real
  `identity_keywords` over ~10 probes per NPC (≥ 120 probes total) and record
  whether the gold target appears in the returned top-5 and at what rank.
- *(b) Fact-recall — end-to-end, scripted.* In conversation 1 (day *d*), the
  player states *K* canonical facts to an NPC (major, hometown, a fear, a
  relationship). Advance ≥ 1 day to force `consolidateMemoriesForNPC()`. In
  conversation 2, ask *K* targeted recall questions and grade each answer:
  **correct / forgot (graceful) / confabulated (asserts a false specific)**.
  Repeat across fact sets and NPCs. Forgetting and confabulation are scored
  separately — fabrication is the more serious failure.
- *(c) Contradiction audit — LLM-judge over transcripts.* Scan long playthrough
  transcripts for any NPC statement that conflicts with an earlier established
  fact in that player's history; count contradictions per 100 NPC turns.
- *(d) Consolidation faithfulness — LLM-judge.* For a sample of consolidations,
  judge whether each generated **semantic** memory is *entailed* by its source
  episodics (`supported / unsupported / contradicted`), catching invented
  "patterns" the reflection step might hallucinate.

**3) Metric.** Headline: **Precision@5** and **Mean Reciprocal Rank (MRR)** on
the labeled probe set; **fact-recall accuracy %** and **confabulation rate %**
end-to-end. Supporting: contradictions per 100 turns; % of semantic memories
judged "supported."

**4) Success threshold / comparison.**
- **Precision@5 ≥ 0.80 and MRR ≥ 0.75**, *and* the full composite
  (similarity + importance + recency + identity re-rank) must beat a
  **similarity-only ablation** by **≥ 0.10 absolute Precision@5**. This both
  clears a bar and justifies the design's complexity — if the identity re-rank
  and importance weighting don't beat cosine similarity, they aren't earning
  their place.
- **Fact recall ≥ 90%** on explicitly-stated facts rated importance ≥ 5;
  **confabulation ≤ 2%** (the hard line).
- **Contradiction rate < 1 per 100 NPC turns**; **consolidation faithfulness ≥ 95% supported.**

---

## 3. Dimension 2 — Relationship Validity

**1) Definition.** Whether the relationship state — the three primitives
trust/respect/vibe (each 0–1) and the derived cofounder/close-friend/
study-partner/frenemy labels — moves in the **direction a reasonable observer
would agree with** given what happened in a conversation, and whether the
**magnitude is calibrated** (≈ 0 for small talk; ±0.10–0.20 reserved for
genuinely significant moments, as the judge prompt in `lib/relationships.ts`
specifies). "Valid" means the deltas track informed human judgment *and* respect
each NPC's stated values (`judge_summary`), rather than defaulting to positivity.

**2) Testing methodology.**

- *(a) Human↔model agreement.* Assemble *M* transcripts spanning the spectrum
  (warm, hostile, intellectually impressive, shallow, vulnerable, neutral). For
  each, collect the system's judged deltas and ≥ 2 humans' independent
  predictions of the **sign and ordinal magnitude** (−2…+2) for each dimension,
  given the same `judge_summary` the model sees. Compute human↔human IRR first
  (the ceiling), then human↔model agreement.
- *(b) Sign accuracy.* The core property: for each transcript×dimension, does the
  model delta's sign match the human-consensus sign? Treat |consensus| ≈ 0 as
  "no change" within a tolerance band.
- *(c) Magnitude calibration.* Bucket conversations by human-rated significance
  (neutral / ordinary / significant) and inspect the model's |delta|
  distribution per bucket; correlate human significance with model |delta|.
- *(d) Value-sensitivity (discriminant validity).* Run **the same transcript**
  (e.g., a slick startup pitch) through the judge for **different NPCs** and
  verify divergence in the predicted direction — Jake's respect should rise,
  Priya's should not (her `judge_summary` says hype repels her). This tests that
  the character actually conditions the verdict.
- *(e) Derived-metric unit checks.* Deterministic: over a grid of (T,R,V)
  inputs, assert `computeDerivedMetrics()` matches intuition (high-respect/low-
  vibe ⇒ high frenemy, low close-friend, etc.).
- *(f) Anti-drift battery.* Run a set of deliberately-neutral exchanges; the mean
  delta should be ≈ 0, confirming scores don't ratchet upward.

**3) Metric.** Headline: **sign-agreement accuracy %** (model vs. human
consensus) and **Spearman ρ** between human-rated significance and model
|delta|. Supporting: ordinal agreement (Krippendorff's α vs. human↔human
ceiling); value-sensitivity pass rate %; neutral-battery mean delta with 95% CI.

**4) Success threshold / comparison.**
- **Sign agreement ≥ 85%** overall, and within a small margin of the human↔human
  sign-agreement ceiling.
- **Significance↔magnitude ρ ≥ 0.6.**
- **Value-sensitivity ≥ 80%** of contrast pairs diverge as predicted — *and* this
  must beat an **ablation that feeds the judge a generic values summary** instead
  of the NPC's real `judge_summary`. If the character files don't change the
  verdicts, the per-NPC authoring isn't doing anything.
- **Neutral-battery mean delta:** |mean| < 0.01 (95% CI contains 0).
- **Derived-metric unit checks: 100% pass** (deterministic).

---

## 4. Dimension 3 — Cultural Authenticity

**1) Definition.** The degree to which NPC dialogue convincingly inhabits the
*specific* subculture of contemporary Stanford — its places (Green Library, Coupa,
Gates basement, EVGR), institutions (SLE, SymSys, CS106B/229/231N, Cardinal
Ventures), status games, and per-archetype register (startup-speak, ML-lab
vocabulary, pre-med grind, humanities snobbery) — without lapsing into generic
"college student" filler, anachronism, or self-parody. It is judged on both
**positive markers** (does it sound like Stanford) and **absent tells** (does it
ever sound like a chatbot or the wrong campus).

**2) Testing methodology.**

- *(a) Recognizability rating — human, the core metric.* Sample *J* dialogue
  snippets per NPC from real playthroughs. Stanford-affiliated raters (or
  rubric-briefed raters) score each on **1–5 Likert** scales for: authenticity
  ("a real Stanford person could have said this"), voice fidelity (matches that
  NPC's `speaking_style`), and absence-of-LLM-tells (no therapyspeak, no "I hear
  you," no life-coach register). Raters are blind to any quality label.
- *(b) Cultural-marker density — automated proxy.* Measure correct, in-context
  Stanford references per 100 NPC tokens, using a lexicon built from the union of
  all NPCs' `identity_keywords` **plus an independent hand-built campus
  gazetteer** (to reduce circularity). A human appropriateness pass filters out
  forced name-drops so we reward *use*, not keyword-stuffing.
- *(c) Negative-marker / format scan.* LLM-or-human scan for tells: wrong-campus
  geography, out-of-world references, modern-chatbot register, asterisk stage
  directions and `[Day N]` metadata (both explicitly banned in the NPC prompts —
  so this doubles as a format-compliance check) and fourth-wall breaks.
- *(d) Register-discrimination ("voice Turing test").* Give raters a snippet and
  the 12 one-line `speaking_style` descriptors; ask them to match snippet → NPC.
  Above-chance accuracy proves authenticity is **character-specific**, not one
  uniform "Stanford voice" smeared across everyone.
- *(e) Caricature check.* Raters flag snippets that read as parody rather than
  person (Jake reduced to "ship it / TAM / moat" every line); report parody-flag
  rate.

**3) Metric.** Headline: **authenticity Likert mean (1–5)** with CI, per NPC and
overall (plus voice-fidelity and absence-of-tells sub-scales). Supporting:
register-discrimination accuracy % vs. 8.3% chance (1/12); negative-marker rate
per 100 turns and format-compliance %; appropriateness-filtered marker density;
parody-flag rate %.

**4) Success threshold / comparison.**
- **Authenticity Likert mean ≥ 4.0 / 5** with lower CI bound ≥ 3.5;
  absence-of-tells ≥ 4.0.
- **Register-discrimination ≥ 50%** (≈ 6× chance) — a stranger can usually tell
  who is speaking.
- **Negative-marker rate < 1 per 100 turns; format-compliance ≥ 98%.**
- **Ablation (the key comparison):** run identical scenarios with the
  `identity_prompt` replaced by a bare "you are a Stanford student named X."
  The full character files must raise the authenticity mean by **≥ 1.0 Likert
  point**, demonstrating that the authoring — the actual contribution — drives
  authenticity, not the base model's generic Stanford prior.

---

## 5. Dimension 4 — Inter-NPC Coherence

**1) Definition.** Whether the off-screen social world hangs together as it
evolves: the auto-generated NPC↔NPC events (`scripts/generate-inter-npc-events.ts`),
the relationship drift they produce on release (`lib/events.ts`), and the
memories they write into both NPCs are mutually consistent, faithful to each
pair's established canon and archetype affinities, and free of contradictions
(no warm bonding event between characters canon says are cold; no relationship
lurching without a justifying event). Coherence is a property of **the system as
a whole** staying believable over the 14-day arc, not of any single conversation.

**2) Testing methodology.**

- *(a) Canon-consistency of events — LLM-judge + human spot-check.* For sampled
  `inter_npc_events`, an evaluator holding both NPCs' identity files (especially
  their `YOUR RELATIONSHIPS` sections) labels each **plausible / implausible /
  contradicts-canon**, including whether the delta sign matches canon (a
  Jake↔Priya event should reflect her coldness).
- *(b) Affinity↔activity correlation — automated.* The generator is *designed* to
  scale event count with `archetype_affinity_prior` (> 0.7 → 4–6 events;
  0.4–0.7 → 2–3; < 0.4 → 0–1). Correlate each pair's realized event count against
  its affinity prior to confirm the generator honors its own rule.
- *(c) Trajectory sanity — automated replay.* Replay the 14-day release and track
  each pair's T/R/V. Check: canon-close pairs (Ben↔Priya, Eliza↔June, Alex↔DJ)
  stay high; canon-cold pairs don't drift warm; **no band-flip (high↔low) without
  a justifying event**; scores stay in [0,1]; and **variance is preserved** (the
  world doesn't collapse to a uniform mean).
- *(d) Triangulation — automated.* For sampled released events, verify the three
  artifacts agree: the episodic memory written to **both** NPCs describes the
  same event, the system `relationship_events` row links to that event
  (`inter_npc_event_id`, `player_id = NULL`), and the delta sign matches the
  memory's valence. This validates `releaseEventsForDay()` by construction.
- *(e) Cross-NPC reference consistency — scripted.* After a released event,
  converse with **both** endpoints and an uninvolved third NPC; check that
  accounts of who-did-what don't contradict.
- *(f) Network face validity — human.* Show raters the day-14 network (`/network`)
  and top cofounder pairs; ask whether the cluster structure "looks right" given
  the bios (Likert + qualitative).

**3) Metric.** Headline: **event-plausibility %** (and contradicts-canon %, the
hard failure); **affinity↔activity correlation** (Pearson/Spearman); **drift
Spearman** between the seeded-prior composite ranking and the day-14 ranking
across all 66 pairs. Supporting: % of canon-anchored pairs ending in the expected
band; unjustified band-flip count; day-14/day-0 variance ratio; triangulation
mismatch %; cross-reference contradiction count; network face-validity Likert.

**4) Success threshold / comparison.**
- **Event plausibility ≥ 90%; contradicts-canon ≤ 5%.**
- **Affinity↔activity ρ ≥ 0.7** — the generator clearly follows its own design rule.
- **Drift Spearman in a "Goldilocks" window of 0.60–0.95.** This is the most
  honest single number here: a correlation near **1.0** would mean the events
  changed nothing (dead world); below **0.5** would mean the world is unstable
  noise that forgets its own canon. We want movement that is *real but bounded*.
- **Trajectory:** ≥ 90% of canon-anchored pairs end in the expected band; **zero
  unjustified band-flips**; day-14 composite std-dev ≥ ~70% of day-0 (world stays
  differentiated).
- **Triangulation mismatch 0%; cross-reference contradictions ≈ 0** per scenario;
  network face-validity ≥ 4.0 / 5.

---

## 6. Limitations and threats to validity

We hold these results to the standard of *evidence*, not proof. The following
threats are real and, where possible, we name the mitigation — but several cannot
be fully removed at this project's scale.

**Sampling and statistical power.**
- **Single-player, single-author corpus.** The game is currently single-player
  and most transcripts come from one or two people. *n* is small, confidence
  intervals will be wide, and one person's idiosyncratic play style can dominate
  what gets stored and therefore what gets measured. Numbers should be read as
  directional, not precise.
- **Sampling, not exhaustion.** 12 NPCs, 66 pairs, and a 14-day arc are sampled,
  not covered exhaustively. Rare pairings and long-horizon behavior are
  under-tested, and the fixed 14-day window means **we never observe steady
  state** — drift conclusions may not extrapolate to a hypothetical day 50.
- **Cost ceilings cap *n*.** Each end-to-end fact-recall run spans multiple
  API calls across multiple in-game days; multi-seed evaluation across all 12
  NPCs is expensive, which is the practical reason samples stay small.

**Evaluator bias and circular references.**
- **Author = evaluator.** The person who wrote the NPC bios is often the person
  judging authenticity and canon-consistency — strong demand characteristics and
  confirmation bias. Mitigated (not eliminated) by blind snippets, external
  Stanford raters, and pre-registered rubrics.
- **LLM-as-judge circularity.** Several metrics (consolidation faithfulness,
  event plausibility, contradiction scans) use an LLM judge while the system under
  test is also an LLM — often the same Claude family — so they can share blind
  spots and rate *fluent-but-wrong* output as fine. Mitigated by calibrating the
  judge against human labels and preferring a different model family, but shared
  failure modes remain.
- **Keyword-metric leakage.** Cultural-marker density partly uses a lexicon
  derived from `identity_keywords`, which is *also fed to the model* — grading it
  on terms we told it to care about. Mitigated by the independent campus gazetteer
  and the human appropriateness pass, but partial circularity persists.

**Construct validity — are we measuring the right thing?**
- **"Authenticity" is subjective and culturally narrow.** It encodes one slice of
  Stanford (techy, pre-professional, ~2020s) and our raters are a convenience
  sample. The metric measures *recognizability to our raters*, not ground-truth
  authenticity. Stereotype and authenticity also correlate, so high marker density
  can mask caricature — the parody-flag mitigates this but is itself subjective.
- **Relationship "gold labels" are judgments, not truth.** Trust/respect/vibe
  deltas have no objective referent; "human consensus" is a few raters. We measure
  *agreement with a constructed reference*, and inter-rater reliability bounds how
  good any system could possibly look.
- **Memory recall is only observable when probed.** We can test whether a memory
  surfaces *when asked*, but not easily whether a memory that *should* have come
  up spontaneously in natural play failed to. Probe-set precision therefore
  **overstates** real-play recall.

**Reproducibility and external validity.**
- **Non-determinism.** Chat runs at temperature 0.5; judging, consolidation, and
  event generation are all stochastic. A single run is not reproducible, and
  end-to-end runs are **path-dependent** (what gets stored depends on earlier
  stochastic turns). Sound estimates require multiple seeds and variance
  reporting, multiplying cost.
- **Single base model, single point in time.** All results are for Haiku-4.5 chat
  / Sonnet-4.6 judging as of this evaluation. A model update could shift every
  metric; conclusions may not transfer across versions.
- **No engagement / "is it fun" metric.** We measure internal consistency and
  authenticity, not whether the game is enjoyable or whether players form the
  intended impressions of the NPCs. External validity to "this is a good
  experience" is explicitly out of scope here and left to future playtesting.

---

## 7. Reproducibility notes

- Clean baselines: `scripts/reset-game.ts --player-id <id>` (restores from the
  `npc_npc_relationships_priors` snapshot).
- Retrieval benchmark: extend `scripts/eval-retrieval.ts` with gold labels;
  identity-matching unit behavior: `scripts/test-identity-relevance.ts`.
- All evaluation runs should record: model IDs, retrieval weights
  (`1.0 / 1.5 / 0.7` SQL + `0.3` identity, per `lib/memory.ts`), delta clamp
  (`±0.2` conversational, `±0.05` inter-NPC), and the `reset-game` seed state, so
  a run can be reconstructed up to model stochasticity.
