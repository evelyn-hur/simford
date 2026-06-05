# Evaluation

_Draft of the evaluation section. Detailed protocol in `evaluation/PLAN.md`; full
numbers in `evaluation/results/ANALYSIS.md`; failure diagnoses in
`evaluation/FAILURE_ANALYSIS.md`._

## Methodology

The system is evaluated along four dimensions — **memory consistency**,
**relationship validity**, **cultural authenticity**, and **inter-NPC coherence** —
each with a definition, metric, and success threshold fixed in advance
(`evaluation/PLAN.md`). Twenty scripted scenarios (YAML) replay a sequence of setup
turns and a probe against the running app's real endpoints (`/api/chat`, the
conversation-end relationship judge, advance-day), capturing what the NPC said, which
memories it retrieved, and what relationship deltas were applied. Every scenario runs
in two modes: the full **system** (cross-session memory retrieval + relationship
state + inter-NPC social context) and a **stateless baseline** ablation that keeps the
character prompt and the in-session turns but disables all cross-session state,
toggled per request via an `X-Eval-Mode` header. Scoring is mixed by dimension:
deterministic keyword and delta-direction checks, an LLM judge (Sonnet 4.6 — a
different model family from the Haiku chat model, calibrated against human labels), and
blind human ratings for cultural authenticity. Variance-prone probes are replayed five
times, and the runner resets to an identical seeded world before each scenario.

## Results

| Dimension | Baseline | System | Gap (95% CI) |
| --- | --- | --- | --- |
| **Memory consistency** | 33% (2/6) | **85% (11/13)** | **+51 pp** [+9, +94]; z = 2.24, p ≈ .025 |
| Relationship validity | 100% (6/6) | 100% (10/10) | +0 pp |
| Inter-NPC coherence | 75% (3/4) | 75% (6/8) | +0 pp (n.s.) |
| Cultural authenticity | _human-rated_ | _human-rated_ | see expert ratings |
| **Overall (auto-scored)** | **71%** | **88%** | **+17 pp** |

The pattern is sharp and diagnostic of what the architecture actually adds. The only
dimension with a statistically detectable gap is **memory consistency**: with
retrieval on, NPCs reused player disclosures **85%** of the time versus **33%** in the
stateless ablation (+51 percentage points; two-proportion z = 2.24, p ≈ 0.025). At the
tag level the contrast is even starker — on probes about concrete academic and
technical facts (research topic, startup idea, hometown), the system passed **100%**
while baseline passed **0%**. The mean LLM-judge score on memory rose modestly (3.00 →
3.33 / 5), but its variance collapsed (sd 2.83 → 1.37): baseline doesn't merely score
lower, it scores *erratically*, because without memory an NPC's "recall" is a coin
flip between a lucky guess and a flat denial.

The other three dimensions show **no system–baseline gap**, and that is the finding,
not a disappointment. Relationship validity (100% both), inter-NPC coherence (75%
both), and cultural authenticity all route through machinery the baseline retains —
the character file, the in-session turns, the end-of-conversation judge — so ablating
*memory* was never going to move them. The contrast therefore isolates the
architecture's contribution precisely: it adds **continuity** — carrying a specific
fact across a session boundary and a simulated day — not better prose, sharper
in-conversation judgment, or a more convincing voice. The system makes NPCs *remember
you*; it does not make them *sound more like themselves*. That is exactly the claim the
design set out to support, and the ablation is what licenses making it.

## External expert ratings

Cultural authenticity was validated by **eight external raters** through a blind survey
(`/eval-rate`) that hid which system produced each reply and randomized presentation
order. On "sounds like a real Stanford student," system responses averaged **4.13 ±
0.85** versus baseline **3.81 ± 1.03** (Δ +0.31); on voice distinctiveness the two were
**tied** (3.86 vs 3.84). Inter-rater reliability was moderate-to-good — mean pairwise
Pearson **r = 0.41** (authenticity) and **0.62** (voice) over twelve commonly-rated
responses — so raters were tracking a shared construct, not noise. Independent human
judges thus *converge with the automated finding* that the memory system does not
improve voice: a credibility multiplier, because the result holds across instruments.
_(If the raters are Stanford-affiliated, state it — it directly strengthens the
campus-authenticity claim.)_

## Failure analysis

Even where the system works, evaluation surfaced structured failure modes (full
diagnoses in `evaluation/FAILURE_ANALYSIS.md`); four are worth flagging.
**(1) Retrieved ≠ recalled** — the sharpest result: across five repeats, the *same
retrieved memory* produced "you've got that half-dead Juno-60 on your desk" on one run
and "I'm drawing a blank — we haven't talked about that" on the next. Retrieval and
grounding are decoupled, so retrieval metrics (P@5, MRR) overstate user-visible recall.
**(2) The denial reflex** — when retrieval misses, NPCs confidently *deny* ("we just
met") instead of hedging, the most relationship-damaging failure available and a
posture problem rather than a retrieval one. **(3) Forked shared events** — Eliza
denied June works in gouache, contradicting a seeded event, because shared events are
denormalized into two independently-drifting per-NPC copies with no canonical record.
**(4) A bivalent relationship judge** — on a "brilliant but cutting" exchange the
judge's trust/respect deltas *sign-flipped* across identical repeats (−0.04 ↔ +0.07)
while only vibe stayed stable; the scenario passes only because we narrowed it to vibe.
These cluster at architectural *seams* — the session, retrieval→generation, NPC↔NPC,
and judge-calibration boundaries — and point to a grounding/verification stage between
retrieval and the reply as the highest-leverage fix.

## Limitations

The scenarios were authored by the system's designer (construct-validity risk); the
comparison is single-player against one seeded world; most auto-scored cells have a
single repeat, so confidence intervals are wide; and the planned Day 10–11 user study
(small N) is not yet run — all human evidence currently rests on one blind cultural A/B.
