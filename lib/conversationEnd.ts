import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  judgeRelationshipDeltas,
  applyRelationshipDeltas,
  type RelationshipScores,
  type RelationshipDeltas,
} from "@/lib/relationships";
import type { ChatMessage } from "@/lib/conversations";

const DEFAULT_SCORES: RelationshipScores = {
  trust: 0.5,
  respect: 0.5,
  vibe: 0.5,
};

export type EndConversationStatus =
  | "judged"
  | "already-judged"
  | "skipped-too-few-messages"
  | "not-found";

export interface EndConversationResult {
  status: EndConversationStatus;
  scores: RelationshipScores;
  deltas: RelationshipDeltas | null;
}

/**
 * Idempotently end a conversation: judge it over the full transcript, apply
 * deltas, mark ended_at + judged = true.
 *
 * Race-proof: the very first thing we do is an atomic conditional UPDATE that
 * flips judged=false -> true in a single statement. Only the call that
 * actually flipped the row (RETURNING returns a row) is allowed to run the
 * judge; concurrent callers see judged was already true and return
 * "already-judged". Without this, dev-mode Fast Refresh + React strict-mode
 * double-invocation could fire the safety-net beacon multiple times in
 * milliseconds, slip past a plain "if judged return" guard, and double-write
 * relationship_events.
 *
 * If judge/apply throws after the claim, we revert the claim
 * (judged=false, ended_at=null) so a future call can re-judge — the only
 * branch that holds onto a claim is the one that successfully wrote an
 * event (or determined the conversation was too sparse to need one).
 *
 * Used by /api/conversation/end (sendBeacon from the safety net) and by
 * /api/advance-day (implicit — time passing ends open conversations).
 */
export async function endConversation(
  conversationId: string,
): Promise<EndConversationResult> {
  const supabase = createServiceRoleClient();
  const claimedAt = new Date().toISOString();

  // ── ATOMIC CLAIM ────────────────────────────────────────────────────────
  // Single conditional UPDATE: only succeeds for the call whose snapshot
  // sees judged=false. Postgres serializes the writes; one call wins.
  const { data: claimed, error: claimError } = await supabase
    .from("conversations")
    .update({ judged: true, ended_at: claimedAt })
    .eq("id", conversationId)
    .eq("judged", false)
    .select("id, player_id, npc_id")
    .maybeSingle();

  if (claimError) {
    throw new Error(
      `Failed to claim conversation for judging: ${claimError.message}`,
    );
  }

  // No row returned means either the conversation doesn't exist or it was
  // already judged by a concurrent (or earlier) call. Disambiguate.
  if (!claimed) {
    const { data: existing } = await supabase
      .from("conversations")
      .select("player_id, npc_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!existing) {
      return { status: "not-found", scores: DEFAULT_SCORES, deltas: null };
    }
    return {
      status: "already-judged",
      scores: await fetchScores(
        supabase,
        existing.player_id as string,
        existing.npc_id as string,
      ),
      deltas: null,
    };
  }

  // From here on we are the exclusive judger of this conversation.
  const playerId = claimed.player_id as string;
  const npcId = claimed.npc_id as string;

  try {
    // Full chronological transcript — judge sees everything that happened.
    const { data: msgRows } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    const messages: ChatMessage[] = (msgRows ?? []).map((m) => ({
      role: m.role as ChatMessage["role"],
      content: m.content as string,
    }));

    // Sparse conversation — keep the claim (so it doesn't keep getting
    // re-attempted) but skip the Sonnet call. The claim already wrote
    // ended_at and judged=true.
    if (messages.length < 2) {
      return {
        status: "skipped-too-few-messages",
        scores: await fetchScores(supabase, playerId, npcId),
        deltas: null,
      };
    }

    const currentScores = await fetchScores(supabase, playerId, npcId);

    const deltas = await judgeRelationshipDeltas({
      npcId,
      playerId,
      conversationMessages: messages,
      currentScores,
    });

    const newScores = await applyRelationshipDeltas({
      playerId,
      npcId,
      deltas,
      conversationId,
    });

    return { status: "judged", scores: newScores, deltas };
  } catch (err) {
    // Judge/apply blew up. Revert the claim so a retry can take it.
    const { error: revertError } = await supabase
      .from("conversations")
      .update({ judged: false, ended_at: null })
      .eq("id", conversationId);
    if (revertError) {
      console.error(
        `endConversation: judge/apply failed AND revert of the claim ` +
          `failed (conv=${conversationId}): ${revertError.message}. ` +
          `Manually flip judged=false to allow retry.`,
      );
    }
    throw err;
  }
}

async function fetchScores(
  supabase: ReturnType<typeof createServiceRoleClient>,
  playerId: string,
  npcId: string,
): Promise<RelationshipScores> {
  const { data: rel } = await supabase
    .from("player_npc_relationships")
    .select("trust, respect, vibe")
    .eq("player_id", playerId)
    .eq("npc_id", npcId)
    .maybeSingle();
  if (!rel) return DEFAULT_SCORES;
  return {
    trust: rel.trust as number,
    respect: rel.respect as number,
    vibe: rel.vibe as number,
  };
}
