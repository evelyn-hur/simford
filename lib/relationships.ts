import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { ChatMessage } from "@/lib/conversations";

// Relationship judging is a higher-stakes reasoning task than chat, so it uses
// Sonnet rather than Haiku.
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 512;
const DELTA_LIMIT = 0.2;

export interface RelationshipScores {
  trust: number;
  respect: number;
  vibe: number;
}

export interface JudgeRelationshipDeltasParams {
  npcId: string;
  playerId: string;
  conversationMessages: ChatMessage[];
  currentScores: RelationshipScores;
}

/** Matches the strict-JSON contract and the relationship_events columns. */
export interface RelationshipDeltas {
  delta_trust: number;
  delta_respect: number;
  delta_vibe: number;
  reasoning: string;
}

function zeroDeltas(reasoning = ""): RelationshipDeltas {
  return {
    delta_trust: 0,
    delta_respect: 0,
    delta_vibe: 0,
    reasoning,
  };
}

function clampDelta(n: number): number {
  return Math.min(DELTA_LIMIT, Math.max(-DELTA_LIMIT, n));
}

function clampScore(n: number): number {
  return Math.min(1, Math.max(0, n));
}

type ScoreBand = "low" | "mid" | "high";

// Boundaries: < 0.35 low, > 0.65 high, 0.35–0.65 (inclusive) mid.
function scoreBand(score: number): ScoreBand {
  if (score < 0.35) return "low";
  if (score > 0.65) return "high";
  return "mid";
}

// Per-dimension "descriptor — behavioral instruction" text by band.
const RELATIONSHIP_DESCRIPTORS: Record<
  keyof RelationshipScores,
  Record<ScoreBand, string>
> = {
  trust: {
    low: "guarded — keep things surface-level, don't share anything personal or vulnerable",
    mid: "warming up — willing to share ordinary personal details but not your deepest insecurities",
    high: "high — you're willing to drop the performance occasionally when the player invites it, but you still sound like yourself. Most of the time you're still the same person you've always been.",
  },
  respect: {
    low: "low — you're a bit dismissive of their input",
    mid: "neutral — you take them as a peer",
    high: "high — you genuinely value their perspective and seek it out",
  },
  vibe: {
    low: "cool — you're a little short and not very warm",
    mid: "fine — pleasant but not especially close",
    high: "warm — you enjoy talking to them and it shows",
  },
};

/**
 * Translate numeric relationship scores into a behavioral-guidance section for
 * an NPC's system prompt. NPC-agnostic (pure mapping), so it's reusable across
 * every NPC.
 */
export function buildRelationshipGuidance(scores: RelationshipScores): string {
  return [
    "YOUR CURRENT RELATIONSHIP WITH THIS PERSON:",
    `- Trust: ${RELATIONSHIP_DESCRIPTORS.trust[scoreBand(scores.trust)]}`,
    `- Respect: ${RELATIONSHIP_DESCRIPTORS.respect[scoreBand(scores.respect)]}`,
    `- Vibe: ${RELATIONSHIP_DESCRIPTORS.vibe[scoreBand(scores.vibe)]}`,
  ].join("\n");
}

/**
 * Judge how a single conversation should shift the player↔NPC relationship
 * along trust / respect / vibe, each a delta in [-0.2, 0.2], from the NPC's
 * perspective.
 *
 * Uses Anthropic tool-use: the model is forced to call `record_relationship_change`,
 * so the result arrives as a structured tool input — no JSON parsing. Deltas
 * are clamped to range; if the model doesn't call the tool or the request
 * fails, returns all-zero deltas after logging (judging must never break the
 * caller).
 */
export async function judgeRelationshipDeltas({
  npcId,
  playerId,
  conversationMessages,
  currentScores,
}: JudgeRelationshipDeltasParams): Promise<RelationshipDeltas> {
  // Nothing to judge — skip the API call.
  if (conversationMessages.length === 0) {
    return zeroDeltas("No conversation to evaluate.");
  }

  // Fetch the NPC's identity for context.
  const supabase = createServiceRoleClient();
  const { data: npc, error } = await supabase
    .from("npcs")
    .select("name, archetype, judge_summary")
    .eq("id", npcId)
    .single();

  if (error || !npc) {
    throw new Error(
      `judgeRelationshipDeltas: NPC '${npcId}' not found${
        error ? ` (${error.message})` : ""
      }`,
    );
  }

  // Condensed values summary keeps the judge prompt small — far cheaper than
  // shipping the full identity_prompt / values_json.
  const valuesSummary =
    (npc.judge_summary as string | null)?.trim() ||
    "(no values summary on file)";

  const transcript = conversationMessages
    .map((m) => `${m.role === "player" ? "Player" : npc.name}: ${m.content}`)
    .join("\n");

  const system = `You are an impartial relationship analyst. Your job is to evaluate how an entire conversation affected the relationship between a character (the NPC) and a person they're talking to (the player), from the NPC's perspective.

THE NPC YOU'RE EVALUATING FOR:
Name: ${npc.name}
Who they are: ${npc.archetype}
What they value: ${valuesSummary}
(Score changes should reflect THIS character's values. For example, a character who prizes intellectual rigor will gain respect when challenged well and lose it when given lazy answers; a character who is emotionally guarded will gain trust slowly.)

THE THREE DIMENSIONS (each ranges 0.0 to 1.0, currently as shown):
- TRUST (${currentScores.trust.toFixed(2)}): How safe the NPC feels being open and vulnerable with this person. Rises when the person is reliable, reciprocates openness, keeps confidence. Falls when the person is dismissive of something personal, judgmental, or betrays confidence.
- RESPECT (${currentScores.respect.toFixed(2)}): How much the NPC regards this person's competence, substance, and judgment. Rises with insight, thoughtful pushback, evident skill. Falls with shallowness, ignorance, or unearned arrogance.
- VIBE (${currentScores.vibe.toFixed(2)}): How much the NPC simply enjoys this person's company. Rises with warmth, humor, ease. Falls with friction, awkwardness, or coldness.

These three move INDEPENDENTLY. A brilliant but condescending remark might raise respect (+) while lowering vibe (-). Sharing a vulnerability might raise trust (+) and vibe (+) without touching respect.

CALIBRATION (important):
- You are evaluating an entire conversation, not a single message. Weigh the overall arc — a conversation that started tense but ended warm should reflect the net effect. A long substantive conversation can justify larger deltas than a brief one.
- Most ordinary conversations should produce SMALL deltas: ±0.02 to ±0.05.
- Reserve LARGE deltas (±0.10 to ±0.20) for genuinely significant moments anchored in the conversation: real vulnerability shared, a betrayal, a moment of true intellectual connection, a cutting insult, a broken confidence.
- Neutral small talk (weather, logistics) should produce deltas at or near 0.00.
- Scores can and SHOULD go DOWN when the interaction warrants it. Do not default to positivity. A boring or mildly negative exchange is not a reason to raise scores.

Record your evaluation by calling the record_relationship_change tool.`;

  const userContent = `THE CONVERSATION TO EVALUATE:
${transcript}`;

  const tool: Anthropic.Tool = {
    name: "record_relationship_change",
    description:
      "Record how this conversation changed the NPC's trust, respect, and vibe toward the player, from the NPC's perspective.",
    input_schema: {
      type: "object",
      properties: {
        delta_trust: {
          type: "number",
          description: "Change in TRUST, a float from -0.20 to 0.20.",
        },
        delta_respect: {
          type: "number",
          description: "Change in RESPECT, a float from -0.20 to 0.20.",
        },
        delta_vibe: {
          type: "number",
          description: "Change in VIBE, a float from -0.20 to 0.20.",
        },
        reasoning: {
          type: "string",
          description:
            "One or two sentences, from the NPC's perspective, explaining the changes.",
        },
      },
      required: ["delta_trust", "delta_respect", "delta_vibe", "reasoning"],
    },
  };

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [tool],
      // Force the model to call the tool, so output is always structured.
      tool_choice: { type: "tool", name: "record_relationship_change" },
      messages: [{ role: "user", content: userContent }],
    });

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" &&
        block.name === "record_relationship_change",
    );

    if (!toolUse) {
      console.error(
        `judgeRelationshipDeltas: model did not call the tool ` +
          `(npc=${npcId}, player=${playerId})`,
      );
      return zeroDeltas();
    }

    const input = toolUse.input as {
      delta_trust?: unknown;
      delta_respect?: unknown;
      delta_vibe?: unknown;
      reasoning?: unknown;
    };

    const dt = Number(input.delta_trust);
    const dr = Number(input.delta_respect);
    const dv = Number(input.delta_vibe);

    if (![dt, dr, dv].every(Number.isFinite)) {
      console.error(
        `judgeRelationshipDeltas: non-numeric delta(s) from tool ` +
          `(npc=${npcId}, player=${playerId})`,
      );
      return zeroDeltas();
    }

    return {
      delta_trust: clampDelta(dt),
      delta_respect: clampDelta(dr),
      delta_vibe: clampDelta(dv),
      reasoning: typeof input.reasoning === "string" ? input.reasoning : "",
    };
  } catch (err) {
    console.error(
      `judgeRelationshipDeltas: request failed ` +
        `(npc=${npcId}, player=${playerId}): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return zeroDeltas();
  }
}

export interface ApplyRelationshipDeltasParams {
  playerId: string;
  npcId: string;
  deltas: RelationshipDeltas;
  conversationId?: string | null;
}

/**
 * Apply judged deltas to the player↔NPC relationship: append an audit row to
 * relationship_events and update the materialized scores in
 * player_npc_relationships (each clamped to [0, 1]), creating the relationship
 * row from 0.5 defaults if it doesn't exist yet. Returns the new scores.
 *
 * Sequential (not a single DB transaction) — acceptable at this scale. The
 * materialized scores are written before the audit row so that if the audit
 * insert fails, current state stays correct (we surface the error). See the
 * note at the call site about the read-modify-write race under concurrency.
 */
export async function applyRelationshipDeltas({
  playerId,
  npcId,
  deltas,
  conversationId = null,
}: ApplyRelationshipDeltasParams): Promise<RelationshipScores> {
  const supabase = createServiceRoleClient();

  // 1. Read current scores, or fall back to 0.5 defaults if no row exists yet.
  const { data: existing, error: readError } = await supabase
    .from("player_npc_relationships")
    .select("trust, respect, vibe")
    .eq("player_id", playerId)
    .eq("npc_id", npcId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Failed to read relationship: ${readError.message}`);
  }

  const base: RelationshipScores = existing ?? {
    trust: 0.5,
    respect: 0.5,
    vibe: 0.5,
  };

  const newScores: RelationshipScores = {
    trust: clampScore(base.trust + deltas.delta_trust),
    respect: clampScore(base.respect + deltas.delta_respect),
    vibe: clampScore(base.vibe + deltas.delta_vibe),
  };

  // 2. Upsert the authoritative current state first.
  const { error: upsertError } = await supabase
    .from("player_npc_relationships")
    .upsert(
      {
        player_id: playerId,
        npc_id: npcId,
        trust: newScores.trust,
        respect: newScores.respect,
        vibe: newScores.vibe,
        last_updated: new Date().toISOString(),
      },
      { onConflict: "player_id,npc_id" },
    );

  if (upsertError) {
    throw new Error(`Failed to update relationship: ${upsertError.message}`);
  }

  // 3. Append the audit row (created_at defaults to now()).
  const { error: eventError } = await supabase
    .from("relationship_events")
    .insert({
      player_id: playerId,
      npc_id: npcId,
      delta_trust: deltas.delta_trust,
      delta_respect: deltas.delta_respect,
      delta_vibe: deltas.delta_vibe,
      reasoning: deltas.reasoning,
      conversation_id: conversationId,
    });

  if (eventError) {
    throw new Error(
      `Relationship updated but failed to log event: ${eventError.message}`,
    );
  }

  return newScores;
}
