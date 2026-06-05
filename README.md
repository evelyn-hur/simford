# Simford

A chat-based simulation game where twelve Stanford characters know each other, remember you across sessions, and have relationships that evolve over time.

**[Live demo](https://simford.vercel.app/) · [Demo video](https://www.youtube.com/watch?v=0J9G5CuoCWM) · [Eval results](#evaluation)**
<img width="1470" height="825" alt="Screenshot 2026-06-05 at 12 40 53 AM" src="https://github.com/user-attachments/assets/3eb9ec34-8dea-4a37-9253-760635c944e4" />


## What this is

Twelve LLM-powered Stanford characters — a startup-bro CS major, an ML PhD student, a pre-med with second thoughts, a studio art major, an athlete hiding academic struggles, and seven others. You can chat with any of them. They remember what you said in past conversations, form opinions of you across three independent dimensions (trust, respect, vibe), and exist in a social network with each other that shifts over in-game time.

The point isn't another AI chatbot. The point is a small, navigable social world — the interactive middle ground between Smallville-style society simulation and Character.AI-style dyadic chat.

## Why I built it

Most AI character products are dyadic. You talk to one entity. Even when you have access to many characters, each one lives in its own bubble — they don't know about each other, they don't have history, they don't have opinions of each other. There's no social world.

The 2023 Stanford Generative Agents paper ("Smallville") showed you could give LLM agents persistent memory, reflection, and a social life — but observationally. You watched 25 agents live; you weren't in the world with them. On the commercial side, Character.AI and Replika are interactive but lack the multi-agent substrate.

Simford sits between them: small cast, real social architecture, you as a recurring participant. I made the characters Stanford students because if the goal is believable people, "generic college student" doesn't cut it — and Stanford specifically lets me recruit Stanford-affiliated raters to actually evaluate cultural authenticity.

## How it works

Twelve NPCs defined as Markdown files with identity prompts, speaking style, identity-relevance keywords, and a condensed `judge_summary` for the relationship judge. Each has hidden depths that only surface once player trust is high enough.
<img width="1470" height="794" alt="Screenshot 2026-06-05 at 12 00 09 AM" src="https://github.com/user-attachments/assets/3fbdbd56-3bcd-49de-80ea-b54a27921fc0" />

Memory is stored per-NPC in a Postgres + pgvector store. After each player turn, the conversation gets summarized into episodic memories with importance scores and embeddings. Retrieval combines four signals: semantic similarity, importance, recency, and a tunable identity-relevance term (word-boundary keyword match against the NPC's keyword list). At end-of-day, episodic memories consolidate into higher-level semantic reflections.

Relationships are explicit and three-dimensional (trust / respect / vibe), updated per conversation (not per turn — that was an early refactor for cost and design clarity) by an LLM-as-judge that emits deltas with reasoning. The judge is conditioned on each NPC's values, so the same exchange affects different characters differently. Relationship state feeds back into the prompt — low-trust Jake is guarded, high-trust Jake opens up.
<img width="1470" height="798" alt="Screenshot 2026-06-05 at 12 33 30 AM" src="https://github.com/user-attachments/assets/3209347c-39fc-4aa3-af15-d8f0f4d32fb9" />


Inter-NPC dynamics: I pre-generated around 130 inter-NPC events covering 14 in-game days, weighted by archetype affinity (tech-tech pairs interact more than tech-humanities pairs). When the player advances in-game time, events release into both involved NPCs' memory streams with each NPC carrying their own perspective on what happened. NPC↔NPC relationship state shifts accordingly. The result is a social network whose state visibly evolves as time progresses.
<img width="1470" height="796" alt="Screenshot 2026-06-05 at 12 33 59 AM" src="https://github.com/user-attachments/assets/840e688e-560f-4ae6-80f0-cd978f5bb0e4" />

A `/network` page renders the live social graph (react-force-graph-2d), with filters for different derived metrics (cofounder potential, close friends, study partners, frenemies) and a panel showing recent system-driven relationship changes with their causing events.

## Stack

- **Frontend / API:** Next.js 14 (App Router), TypeScript, Tailwind, deployed to Vercel
- **Database:** Supabase (Postgres + pgvector + auth)
- **LLMs:** Claude Haiku 4.5 for dialogue, Claude Sonnet 4.6 for the relationship judge, memory consolidation, inter-NPC event generation, and the LLM-judge eval
- **Embeddings:** OpenAI `text-embedding-3-small` (1536d)
- **Visualization:** react-force-graph-2d
- **Per-conversation cost:** ~$0.04–0.06

Schema in [supabase/migrations/](supabase/migrations/).

## Evaluation

Full protocol in [evaluation/PLAN.md](evaluation/PLAN.md), results write-up in [evaluation/WRITEUP_EVALUATION.md](evaluation/WRITEUP_EVALUATION.md), failure analysis in [evaluation/FAILURE_ANALYSIS.md](evaluation/FAILURE_ANALYSIS.md).

I built a scripted eval suite: 20 YAML scenarios across four dimensions (memory consistency, relationship validity, cultural authenticity, inter-NPC coherence), each run against the full system and a stateless baseline that retains identity prompts and in-session context but disables all cross-session state. Results:

| Dimension | Baseline | System | Gap |
| --- | --- | --- | --- |
| Memory consistency | 33% | 85% | +51 pp (p ≈ .025) |
| Relationship validity | 100% | 100% | +0 pp |
| Inter-NPC coherence | 75% | 75% | +0 pp |
| Overall (auto-scored) | 71% | 88% | +17 pp |

The pattern is more informative than the headline. Memory is the only dimension with a real gap — and that's exactly what the architecture is supposed to add. The other three dimensions route through machinery the baseline still has (character file, in-session turns, end-of-conversation judge), so ablating memory shouldn't move them. The contrast isolates the architecture's contribution: continuity across sessions, not better voice or sharper in-conversation judgment.

Cultural authenticity was validated by 8 external blind raters (random ordering, mode hidden). System responses scored 4.13/5 on "sounds like a real Stanford student" vs. 3.81 baseline. Inter-rater Pearson r = 0.41–0.62 — raters were tracking a real shared construct. Independent humans converge with the automated finding that memory doesn't improve voice.

The most interesting failure I'm calling **retrieved ≠ recalled**: across repeats of the same scenario, the same retrieved memory could produce confident reference one run and flat denial the next. Retrieval and grounding are decoupled in the current architecture, so retrieval-quality metrics overstate user-visible recall. A verification stage between retrieval and generation is the next thing I'd build.

Limitations: I authored the scenarios myself (construct-validity risk), the evaluation is single-player against one seeded world, most auto-scored cells have a single repeat (wide CIs), and the planned multi-participant user study did not run for time reasons — all human evidence currently rests on the blind authenticity rating.

## What I'd add next

In order of leverage:

1. A grounding stage between retrieval and generation to close the **retrieved ≠ recalled** gap.
2. **Gossip propagation.** Right now the world has shared history baked in, but information from you doesn't propagate through the network. Adding it — Jake telling Marcus about you, with realistic distortion — would draw on actual rumor-transmission research (leveling, sharpening, assimilation).
3. A **2D world** you can walk around in, the way Smallville looks. The visual situatedness does work pure chat can't.
4. **Canonical records** for shared events so they don't quietly fork between NPCs.
5. **Theory of mind:** NPCs explicitly modeling what you've shared with which other characters.
6. **Longitudinal evaluation** of coherence across hundreds of conversations, not dozens.

## Running it locally

```bash
git clone <repo> && cd simford
npm install
cp .env.example .env.local   # fill in Supabase, Anthropic, OpenAI keys
npx supabase db push          # apply migrations
npx tsx scripts/seed-npcs.ts  # seed 12 NPC files + relationship priors
npx tsx scripts/generate-inter-npc-events.ts  # ~$2.50, generates 132 events
npm run dev
```

Reset between sessions: `npm run reset -- --player-id <uuid>`. Run the eval: `npm run eval -- --all --mode system` / `--mode baseline`.

## Related work

- **Park et al., _Generative Agents: Interactive Simulacra of Human Behavior_** (Smallville, 2023). The seminal paper; my memory architecture (composite retrieval, importance scoring, consolidation) is a re-implementation of theirs, extended with player-as-participant, explicit relationship state, NPC↔NPC modeling, and identity-relevance retrieval weighting.
- **Park et al., _Generative Agent Simulations of 1,000 People_** (2024). Validation against human survey responses; informed the believability-evaluation framing.
- **Shinn et al., _Reflexion_** (2023). Related work on agent self-reflection over experience.
- **AI Town** by a16z. Open-source Smallville-style implementation.
- **Allport & Postman, _The Psychology of Rumor_** (1947). Theoretical basis for the proposed gossip-propagation extension (leveling, sharpening, assimilation).

## AI usage disclosure

This project was built with substantial AI assistance, and I want to be specific about which parts.

- **Claude Code** (subscription plan, used heavily) for implementation: writing TypeScript / React / SQL, building the eval runner, debugging, refactoring. Most of the code in this repo was produced by Claude Code under my direction, with me reviewing, editing, and integrating each chunk.
- **Claude (claude.ai)** for design discussion: scoping decisions, architecture tradeoffs, evaluation methodology, the script for my demo video, and this README's structure. The shape of the project — what to build, what to cut, how to evaluate, how to frame it — emerged from those conversations.
- The system itself uses **Anthropic's Claude API** (Haiku 4.5 for dialogue, Sonnet 4.6 for the judge / consolidation / event generation / eval judge) and **OpenAI's embedding API**.
