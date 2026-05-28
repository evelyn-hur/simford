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
    high: "high — you can be genuinely vulnerable, share your hidden fears and doubts if the moment is right",
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

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Pull the JSON object out of a model response that may be wrapped in markdown
 * fences or surrounded by prose. Prefers a fenced block, then falls back to the
 * outermost { ... } span.
 */
function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return body.trim();
  return body.slice(start, end + 1);
}

/**
 * Ask Claude Sonnet to judge how a single conversation should shift the
 * player↔NPC relationship along trust / respect / vibe, each a delta in
 * [-0.2, 0.2], from the NPC's perspective.
 *
 * Parsing is defensive: markdown fences are stripped, deltas are clamped to
 * range, and any failure (parse error, non-numeric deltas) returns all-zero
 * deltas after logging — judging must never break the caller.
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

  const system = `You are evaluating how a single conversation should change the relationship between an NPC and a player in a social simulation game. Judge strictly from the NPC's perspective.

THE NPC
Name: ${npc.name} (${npc.archetype})
Values summary: ${valuesSummary}

You will be given the current relationship scores and the recent conversation, and must decide how this specific conversation nudges three INDEPENDENT dimensions:
- trust: the NPC's willingness to be open and vulnerable with the player
- respect: the NPC's perception of the player's competence and substance
- vibe: how much the NPC enjoyed the interaction

Each dimension currently sits in [0, 1]. Return a DELTA for each in [-0.2, 0.2].

CALIBRATION
- Most ordinary conversations should produce SMALL deltas (±0.02 to ±0.05).
- Reserve LARGE deltas (±0.1 to ±0.2) for genuinely significant moments: vulnerability shared, a betrayal, real intellectual connection, a real insult.
- The dimensions move independently. A brilliant but arrogant remark might raise respect while lowering vibe; sharing a secret might raise trust without touching respect.
- A forgettable or neutral exchange should be at or near zero.

Respond with ONLY a JSON object — no markdown, no prose — in exactly this shape:
{
  "delta_trust": <float between -0.2 and 0.2>,
  "delta_respect": <float between -0.2 and 0.2>,
  "delta_vibe": <float between -0.2 and 0.2>,
  "reasoning": "<one or two sentences explaining the changes from the NPC's perspective>"
}`;

  const userContent = `CURRENT SCORES (0–1)
trust: ${currentScores.trust}
respect: ${currentScores.respect}
vibe: ${currentScores.vibe}

RECENT CONVERSATION
${transcript}

Evaluate how this conversation should change the relationship. Respond with only the JSON object.`;

  let rawText = "";
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: userContent }],
    });

    rawText = extractText(message);
    const parsed = JSON.parse(extractJsonObject(rawText)) as Record<
      string,
      unknown
    >;

    const dt = Number(parsed.delta_trust);
    const dr = Number(parsed.delta_respect);
    const dv = Number(parsed.delta_vibe);

    if (![dt, dr, dv].every(Number.isFinite)) {
      throw new Error("non-numeric delta(s) in model output");
    }

    return {
      delta_trust: clampDelta(dt),
      delta_respect: clampDelta(dr),
      delta_vibe: clampDelta(dv),
      reasoning:
        typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch (err) {
    console.error(
      `judgeRelationshipDeltas: failed to parse model output ` +
        `(npc=${npcId}, player=${playerId}): ` +
        `${err instanceof Error ? err.message : String(err)}. ` +
        `Raw: ${rawText.slice(0, 300)}`,
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
