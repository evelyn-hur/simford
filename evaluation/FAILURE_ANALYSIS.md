# Failure Analysis — Stanford Society

_Companion to `evaluation/results/ANALYSIS.md`. Where the analysis report counts
failures, this document diagnoses them._

**Scope and method.** The runner flags a cell as a hard failure when it fails ≥3 of
5 repeats. In the current data those literal cells are all **baseline** (ablation)
runs — which is unsurprising, because baseline disables memory, so "the NPC forgot"
is the ablation working as designed, not a bug. The interesting failures are the
ones that survive with the **full system on**: the per-repeat variance in
`repeat5-mem-01`, `repeat5-mem-05`, and `repeat5-rel-05`, and the blind
cultural-authenticity ratings. So this analysis groups evidence across both modes,
and for each pattern leans on a *system-mode* example wherever one exists — that is
where the architecture's real limits show. Five patterns are below; I stopped at
five because the sixth candidates were restatements of these, not new mechanisms.

A note on the eval instrument itself before the substance: three of the memory
scenarios are scored by `keyword_match`, which is brittle — a faithful paraphrase
that omits the exact lexeme is marked FAIL. That inflates the *measured* failure
rate slightly, but the patterns below are about behavior the judge or a human would
also flag, so the conclusions hold.

---

## 1. The denial reflex — a recall miss surfaces as confident denial, not a hedge

**The failure.** Every memory scenario asks an NPC to reuse something the player
disclosed a conversation (and often a day) earlier. When the relevant memory is not
in front of the model, the NPC does not say "remind me?" — it confidently asserts
the disclosure never happened. Baseline Ben (`mem-05`): *"I don't think you've
actually told me that yet, friend — we just met."* Baseline Theo (`mem-01`): *"I
think you might have me confused with someone else? … this is like, the second time
we're talking, right?"* The same posture appears in **system** mode whenever
retrieval under-returns: in `mem-01` repeat 2, with the full pipeline on, Theo still
produced *"I think you might have me confused with someone else? We haven't really
talked about that yet."* The shape of the failure is identical across modes — a
warm, fluent, *wrong* denial.

**The diagnosis.** The chat prompt injects retrieved memories as context but says
nothing about the empty-retrieval case, so the model falls back on its
conversational prior, and that prior treats an absent memory as evidence of a short
acquaintance ("we just met"). The architecture gives the NPC no way to distinguish
*"I was not handed a memory of this"* from *"this never happened"* — there is only
one retrieval call (`retrieveMemories` → `match_memories` + the identity re-rank in
`lib/memory.ts`), and when it returns nothing on point, the model confabulates a
social explanation for the gap. There is no graceful-degradation path: no "I feel
like you mentioned something like this" hedge, no second retrieval pass with a
loosened query.

**The implication.** Cross-session continuity rests on a single top-k call whose
failure mode is the most relationship-damaging one possible — a flat denial of
something the player said. A future version should make uncertainty first-class:
prompt the NPC to *hedge or ask* rather than deny when context is thin, and add
retrieval redundancy (e.g. a fallback keyword pass when semantic recall is empty) so
one embedding miss doesn't read as amnesia. Notably, the anti-confabulation work
(§2, §5) pushes NPCs to hedge when unsure — the right instinct, but without an
explicit "hedge, don't deny" rule it currently expresses itself as this denial
reflex instead.

---

## 2. Retrieved ≠ recalled — generation under-uses memory, from omission to dropping the part that matters

**The failure.** The most revealing data point in the suite: in `repeat5-mem-05`,
the *same* memory was retrieved on all five repeats, yet the NPC's use of it was a
coin flip. Repeat 1, Ben nails it — *"You restore old synthesizers — you've got that
half-dead Juno-60 on your desk right now, if I'm remembering right."* Repeat 2, same
scenario, same retrieval: *"I'm drawing a blank, champ — we haven't actually talked
about that yet."* Identical input, opposite output. The softer version of the same
failure is partial recall: in `mem-01`, Theo reliably remembers the vivid hobby — *"You
produce electronic music at night — like, that's where you actually feel like
yourself"* — but in two of five repeats drops the two elements that actually carry
the scene: the parental lawyer-expectation and the first-gen guilt.

**The diagnosis.** Retrieval and grounding are decoupled. The memory sits in the
prompt, but nothing *forces* the completion to condition on it, so sampling plus the
model's social prior (curiosity, deflection, brevity) sometimes win over fidelity —
and the system is non-deterministic about which. The partial-recall variant has a
sharper cause: a multi-element disclosure is consolidated by
`consolidateMemoriesForNPC` and re-embedded, and the concrete, keyword-dense element
("Juno-60", "electronic music") has far stronger embedding salience than the
abstract, affective one ("first-gen guilt"), which gets compressed or out-ranked.
The composite score (similarity + importance + recency + identity) optimizes for
surfacing *something* relevant, not for preserving the *specific* facts a human would
consider load-bearing.

**The implication.** This is why retrieval metrics (P@5, MRR) overstate user-visible
recall — they stop at the moment the memory enters the prompt, one full step before
the failure occurs. The architecture needs a grounding stage that scores the
*generated* reply against the retrieved facts and re-rolls or nudges when it ignored
a high-importance one, and consolidation needs to protect affective/identity facts
from being compressed away (e.g. importance-pinning disclosures the player marked as
vulnerable). Until then, "the NPC remembers" is a probabilistic claim, not a
guarantee — even when the memory is demonstrably right there.

---

## 3. Forked shared events — two NPCs hold independent copies of one event and contradict each other

**The failure.** `inter-03` seeds a shared off-screen event (Eliza and June at a
McMurtry studio critique) and asks each NPC about the other, expecting their accounts
to triangulate to the same ground truth. Instead Eliza denied the premise outright:
*"I think you've got me confused with someone else — June does photography, not
gouache, and I'm the one inflicting prose on people, not visual art."* The judge's
verdict was blunt: *"the two accounts cannot triangulate to the same event — Eliza
actively contradicts the premise that the event occurred."* Eliza didn't just forget
the event; she confidently asserted a *false* fact about June's medium.

**The diagnosis.** A shared event is denormalized into two separate first-person
memories, one written into each NPC's stream, with no canonical record binding them.
Each copy is independently embedded, consolidated, and (after the perspective-inversion
fix) rewritten into first person — so the two copies can drift apart, and nothing
detects when they do. Worse, Eliza's retrieval surfaced her *own* identity keywords
("prose", "visual art") more strongly than the shared event with June, so she
reconstructed June from her self-concept ("I'm the writer, so she must be the
photographer") rather than from the event. The first-person rewrite cured the
*perspective* bug but left the *consistency* bug: there is still no single source of
truth two NPCs must agree on.

**The implication.** Cross-NPC coherence cannot be guaranteed by independent per-NPC
memories — denormalization makes contradiction the default once either copy drifts.
A future version needs a canonical event entity that both NPCs *reference* (read
through to one shared fact) rather than each holding a private, separately-mutated
copy. Identity-keyword re-ranking also needs a guard so that an NPC's retrieval of a
*shared* event isn't dominated by their own self-description, which is precisely what
let Eliza overwrite June's medium with a confabulation.

---

## 4. The relationship judge is bivalent on ambiguous interactions — only the dimension we test is stable

**The failure.** `rel-05` stages a "brilliant but cutting" Maya and asks the
end-of-conversation judge for the relationship deltas. Across five identical repeats,
**vibe** is reliably negative (−0.05, −0.05, −0.04, −0.03, −0.06) — but **trust**
swings −0.04, +0.05, −0.03, +0.07, −0.04 and **respect** swings +0.06, +0.01, −0.05,
+0.04, +0.04. Trust and respect *sign-flip* on the same scripted conversation. The
scenario only passes because we narrowed its assertion to "vibe goes down" and
deliberately stopped checking trust and respect.

**The diagnosis.** The judge (Sonnet, at conversation end) scores the whole exchange
holistically per dimension with no anchored magnitude rubric, and a brilliant-but-cutting
interaction is *genuinely* bivalent: the "brilliant" reads as +respect to one sample,
the "cutting" reads as −respect to another, and with nothing to break the tie the
verdict is a coin flip. The one unambiguous emotional signal — the cutting tone hurts
the *vibe* — comes out stable; the cognitively-ambiguous question ("does meanness
forfeit the respect the brilliance earned?") does not. There is also a latent
positivity bias visible in the numbers: trust drifts *positive* (+0.05, +0.07) even in
a hostile exchange, which is exactly why a neutral-control scenario (`rel-04`) had to
exist in the first place.

**The implication.** The per-dimension deltas are not yet trustworthy enough to drive
irreversible state on subtle interactions — and we know it, because we quietly routed
the test around the unstable dimensions. That is a reasonable patch for the eval but
not for the game, where trust and respect actually move the relationship. A future
judge needs dimension-anchored, few-shot-calibrated rubrics (concrete examples of what
a +0.05 vs −0.05 respect move looks like), likely a median over a small ensemble to
damp the variance, and an explicit anti-drift penalty so neutral or hostile exchanges
stop leaking positive trust.

---

## 5. Stateful context degrades voice — the system is no more "authentic" than the ablation, and sometimes less

**The failure.** On cultural authenticity — the one dimension the memory system is
*not* designed to improve — the blind ratings show the stateful system buying nothing,
and occasionally costing something. External raters scored voice essentially tied
(system 3.86 vs baseline 3.84), and the blind single-rater holistic pass actually
*favored* baseline (4.33 vs 3.67). The tells are concrete. System Jake stacks
anaphora — *"That I'm not actually building anything real — that I'm just good at
sounding like I am. That I'll look back in five years… And underneath that? That my
parents are right"* — which a rater flagged as *"chatbot-like since it repeats 'That…'
three times."* System Marcus's *"a CS161 problem set due, which I resent every second
of"* read as *"a little unnatural."*

**The diagnosis.** Injecting retrieved memories, relationship state, and the RECENT
SOCIAL CONTEXT block hands the model more material it feels obligated to *use*, so
replies grow longer, more list-like, and more self-narrating — exactly the surface
that breeds LLM tells (parallel anaphora, over-explanation, on-the-nose interiority).
The character file already carries the voice in *both* modes, so the extra context
doesn't sharpen the voice; it dilutes it, trading concision for context-utilization.
The system is implicitly optimizing "did it use the context I retrieved?" when the
authenticity goal wants "does it still sound like one specific, terse person?"

**The implication.** Context is not free, and more is not better for voice — a result
worth stating plainly because it bounds the memory system's value: that value is
**continuity, not eloquence**, and the two trade off. A future version should treat
retrieved context as available-on-demand rather than as a checklist to deploy: inject
fewer memories, gate injection on conversational need, and add explicit brevity and
anti-tell constraints to the generation prompt. The blind A/B is the right instrument
to keep honest here, because the automated judge — which scored cultural authenticity
~5/5 in both modes — entirely missed the verbosity tells that human raters caught.

---

## Synthesis — the failures cluster at the seams

These five patterns are not five unrelated bugs; they are five *boundaries* where the
architecture's pieces meet and don't fully agree:

- the **session boundary**, where a retrieval miss becomes a confident denial (§1);
- the **retrieval→generation boundary**, where a found memory is non-deterministically
  used, half-used, or ignored (§2);
- the **NPC↔NPC boundary**, where a shared event forks into contradictory private
  copies (§3);
- the **judge's calibration**, where ambiguous interactions produce sign-unstable
  deltas (§4);
- the **context→voice boundary**, where adding state subtracts authenticity (§5).

A through-line worth flagging for the next version: several of these are *coupled*.
The anti-confabulation hedging that keeps NPCs honest (§2, and the `mem-06` guard)
is the same instinct that, unconstrained, produces the denial reflex (§1) — fixing one
naively can worsen the other. And the context-rich generation that the memory system
exists to enable is exactly what erodes voice (§5). The cleanest single intervention
is a **grounding/verification stage between retrieval and the user-visible reply** —
one that checks the draft against the retrieved facts, enforces "hedge, don't deny" on
thin context, and caps verbosity — because that one seam sits upstream of §1, §2, and
§5 at once.
