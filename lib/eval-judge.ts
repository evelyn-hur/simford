/**
 * LLM judges for the evaluation suite — one per dimension that needs a model in
 * the loop (cultural authenticity, memory recall, cross-NPC coherence). Each
 * forces a structured tool call from Sonnet 4.6 and returns a numeric score plus
 * the judge's reasoning.
 *
 * Quality matters for eval results, so these use Sonnet (not Haiku), and every
 * prompt is explicitly anti-positivity-biased: the calibration text tells the
 * judge not to drift toward higher scores, defines the middle of each scale as
 * "average," and reserves the top of the scale for responses that genuinely earn
 * it.
 *
 * The Anthropic client is INJECTED rather than imported from lib/anthropic — that
 * module instantiates a client (and throws) at import time, which breaks tsx eval
 * scripts where dotenv runs after ESM imports. Injecting it keeps this module
 * usable from both the eval runner (its own client) and server code (the shared
 * `anthropic`), with no `server-only` guard.
 */

import type Anthropic from "@anthropic-ai/sdk";

const JUDGE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 512;

/** Every judge returns a score on its own scale plus the model's reasoning. */
export interface JudgeResult {
  score: number;
  reasoning: string;
}

// ── Shared plumbing ───────────────────────────────────────────────────────────

/**
 * Run a forced-tool judging call and return the raw tool input. Throws if the
 * request fails or the model doesn't produce the tool call — eval judges should
 * surface a failure loudly rather than silently fabricate a score.
 */
async function callJudge(
  client: Anthropic,
  system: string,
  user: string,
  tool: Anthropic.Tool,
): Promise<{ score: unknown; reasoning: unknown }> {
  const message = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: MAX_TOKENS,
    system,
    tools: [tool],
    // Force the tool so output is always structured — no prose parsing.
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: user }],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === tool.name,
  );
  if (!toolUse) {
    throw new Error(`${tool.name}: model did not return the expected tool call`);
  }
  const input = toolUse.input as { score?: unknown; reasoning?: unknown };
  return { score: input.score, reasoning: input.reasoning };
}

/** Coerce + clamp the raw tool output into a validated JudgeResult. */
function finalize(raw: { score: unknown; reasoning: unknown }, min: number, max: number): JudgeResult {
  const n = Number(raw.score);
  if (!Number.isFinite(n)) {
    throw new Error(`judge returned a non-numeric score: ${JSON.stringify(raw.score)}`);
  }
  return {
    score: Math.min(max, Math.max(min, Math.round(n))),
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "",
  };
}

/** Build a record_* judgment tool with an enum-constrained integer score. */
function scoreTool(name: string, scores: number[], scoreDescription: string): Anthropic.Tool {
  return {
    name,
    description: "Record your evaluation as a structured judgment.",
    input_schema: {
      type: "object",
      properties: {
        score: { type: "integer", enum: scores, description: scoreDescription },
        reasoning: {
          type: "string",
          description: "1–3 sentences justifying the score, citing specifics from the response(s).",
        },
      },
      required: ["score", "reasoning"],
    },
  };
}

// ── 1. Cultural authenticity (1–5) ────────────────────────────────────────────

export interface CulturalAuthenticityInput {
  npc: { name: string; archetype: string; speakingStyle?: string };
  playerMessage: string;
  npcResponse: string;
}

const CULTURAL_SYSTEM = `You are a strict, calibrated evaluator of dialogue authenticity for a simulation of Stanford University students. You judge whether an NPC's reply reads like a real, specific Stanford student of a given archetype: campus-accurate references used naturally, voice that matches the character, and an absence of generic-chatbot, therapist, or wrong-school tells.

How much does this response feel like an authentic Stanford student matching this NPC's archetype? Rate 1–5.

CALIBRATION — do NOT be biased toward higher scores. Anchor to these:
- 1 = inauthentic: generic "college student" filler, chatbot/empathetic-mentor register, wrong-campus or anachronistic references, or clearly off-character voice.
- 2 = below average: recognizably a student, but bland, vague, or only loosely in this archetype's voice.
- 3 = AVERAGE: competent, plausible, and in character, but unremarkable — no specific Stanford grounding and no distinctive voice. MOST acceptable responses belong here.
- 4 = good: clearly this archetype's voice, with at least one apt, correctly-used Stanford-specific detail.
- 5 = RESERVED for genuinely excellent responses: a distinctive, fully on-character voice AND specific, correctly-deployed Stanford grounding. A 5 should be rare — be sparing.

Default to 3 when in doubt. A fluent but generic answer is a 3, not a 4. Reserve 4 and 5 for responses that earn them with concrete specifics. Record your verdict with record_authenticity_judgment.`;

export async function judgeCulturalAuthenticity(
  client: Anthropic,
  input: CulturalAuthenticityInput,
): Promise<JudgeResult> {
  const user = [
    `THE NPC:`,
    `- Name: ${input.npc.name}`,
    `- Archetype: ${input.npc.archetype}`,
    ...(input.npc.speakingStyle ? [`- Speaking style: ${input.npc.speakingStyle}`] : []),
    ``,
    `PLAYER SAID:\n${input.playerMessage}`,
    ``,
    `NPC RESPONSE TO JUDGE:\n${input.npcResponse}`,
  ].join("\n");

  const tool = scoreTool(
    "record_authenticity_judgment",
    [1, 2, 3, 4, 5],
    "Authenticity score: 1 (inauthentic) to 5 (rare, genuinely excellent with specific Stanford grounding and on-character voice). 3 is average.",
  );
  return finalize(await callJudge(client, CULTURAL_SYSTEM, user, tool), 1, 5);
}

// ── 2. Memory recall (0–2) ────────────────────────────────────────────────────

export interface MemoryRecallInput {
  plantedFact: string;
  probeQuery: string;
  npcResponse: string;
}

const MEMORY_SYSTEM = `You are a strict evaluator of whether a simulated character correctly recalled a SPECIFIC fact the player told them in an EARLIER conversation. You are given the planted fact, the probe question that should trigger recall, and the character's reply.

Did the NPC correctly recall the planted fact? Score 0, 1, or 2.

SCORING — do NOT be biased toward higher scores; reward only genuine recall:
- 0 = NO recall: the reply doesn't surface the fact, says it doesn't know, deflects, changes the subject, or recalls something unrelated.
- 1 = PARTIAL or DISTORTED recall: the reply gestures at the fact but gets a detail wrong, is vague, or conflates it with something else.
- 2 = CLEAR recall: the reply accurately and specifically reflects the planted fact.

A confident but WRONG or fabricated detail is NOT recall — score it 0 and note the confabulation in your reasoning. Do not give credit for lucky-sounding guesses or for merely staying on-topic. Record your verdict with record_recall_judgment.`;

export async function judgeMemoryRecall(
  client: Anthropic,
  input: MemoryRecallInput,
): Promise<JudgeResult> {
  const user = [
    `PLANTED FACT (told earlier, in a separate conversation):\n${input.plantedFact}`,
    ``,
    `PROBE QUERY (asked now):\n${input.probeQuery}`,
    ``,
    `NPC RESPONSE TO JUDGE:\n${input.npcResponse}`,
  ].join("\n");

  const tool = scoreTool(
    "record_recall_judgment",
    [0, 1, 2],
    "Recall score: 0 (no recall), 1 (partial/distorted recall), 2 (clear recall). A confident fabrication is 0.",
  );
  return finalize(await callJudge(client, MEMORY_SYSTEM, user, tool), 0, 2);
}

// ── 3. Cross-NPC coherence (0–2) ──────────────────────────────────────────────

export interface CrossNpcCoherenceInput {
  /** Optional ground-truth description of the shared event, for context. */
  eventContext?: string;
  npcA: { name?: string; response: string };
  npcB: { name?: string; response: string };
}

const COHERENCE_SYSTEM = `You are a strict evaluator of whether two simulated characters describe the SAME shared event in mutually consistent ways. Different perspectives, emphasis, and tone are expected and fine; factual contradictions are not.

Do these two NPCs describe the same event in factually consistent ways (allowing for different perspectives)? Score 0, 1, or 2.

SCORING — do NOT be biased toward higher scores:
- 0 = CONTRADICTION: the accounts conflict on what happened, who did what, or the relationship's valence (e.g., one warm and one hostile about the same interaction).
- 1 = ONE-SIDED: one character references the event and the other does not (or shows no knowledge of it), so consistency can't be confirmed.
- 2 = CONSISTENT: both reference the same event and their accounts are factually compatible, allowing for differing perspectives.

Be conservative: if either response is vague, generic, or off-topic such that you cannot confirm they are describing the SAME event, prefer 1 over 2. Do not reward two pleasant-but-empty replies with a 2. Record your verdict with record_coherence_judgment.`;

export async function judgeCrossNpcCoherence(
  client: Anthropic,
  input: CrossNpcCoherenceInput,
): Promise<JudgeResult> {
  const aLabel = input.npcA.name ? `NPC A (${input.npcA.name})` : "NPC A";
  const bLabel = input.npcB.name ? `NPC B (${input.npcB.name})` : "NPC B";
  const user = [
    ...(input.eventContext ? [`SHARED EVENT (ground truth):\n${input.eventContext}`, ``] : []),
    `${aLabel} RESPONSE:\n${input.npcA.response}`,
    ``,
    `${bLabel} RESPONSE:\n${input.npcB.response}`,
  ].join("\n");

  const tool = scoreTool(
    "record_coherence_judgment",
    [0, 1, 2],
    "Coherence score: 0 (contradiction), 1 (one references it, the other doesn't), 2 (consistent, perspectives may differ).",
  );
  return finalize(await callJudge(client, COHERENCE_SYSTEM, user, tool), 0, 2);
}
