import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { advanceInGameDay } from "@/lib/gameState";
import { consolidateMemoriesForNPC } from "@/lib/memory";
import { inGameTimestampForDay } from "@/lib/gameTime";
import { endConversation } from "@/lib/conversationEnd";
import { releaseEventsForDay } from "@/lib/events";

export const runtime = "nodejs";

/**
 * Advance the in-game day by 1 for the player behind a conversation.
 * POST { conversationId } -> { in_game_day }
 */
export async function POST(req: Request) {
  let conversationId: string | undefined;
  try {
    ({ conversationId } = (await req.json()) as { conversationId?: string });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!conversationId) {
    return NextResponse.json(
      { error: "conversationId is required" },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("player_id")
    .eq("id", conversationId)
    .maybeSingle();

  const playerId = conversation?.player_id as string | undefined;
  if (!playerId) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 },
    );
  }

  try {
    const inGameDay = await advanceInGameDay(playerId);
    const nowInGame = inGameTimestampForDay(inGameDay);

    // Fire-and-forget #1: end any open (unjudged) conversations for this
    // player. Advancing the day = "time passed without you talking more," so
    // every open conversation closes out and gets judged here. Non-blocking;
    // the user shouldn't wait on Sonnet calls for the clock to tick.
    void (async () => {
      try {
        const { data: openConvs } = await supabase
          .from("conversations")
          .select("id")
          .eq("player_id", playerId)
          .eq("judged", false);
        const openIds = (openConvs ?? []).map((c) => c.id as string);
        await Promise.all(
          openIds.map((id) =>
            endConversation(id).catch((e) =>
              console.error(
                `advance-day: end of conversation ${id} failed:`,
                e,
              ),
            ),
          ),
        );
      } catch (e) {
        console.error("advance-day end-open-conversations sweep failed:", e);
      }
    })();

    // Fire-and-forget #2: consolidate memories for each NPC this player has
    // talked to. Independent of the end-of-conversation sweep above (they
    // touch different tables — relationship_events vs memory_stream).
    void (async () => {
      try {
        const { data: convs } = await supabase
          .from("conversations")
          .select("npc_id")
          .eq("player_id", playerId);
        const npcIds = Array.from(
          new Set((convs ?? []).map((c) => c.npc_id as string)),
        );
        await Promise.all(
          npcIds.map((id) =>
            consolidateMemoriesForNPC({ npcId: id, nowInGame }).catch((e) =>
              console.error(`consolidation failed for npc=${id}:`, e),
            ),
          ),
        );
      } catch (e) {
        console.error("advance-day consolidation sweep failed:", e);
      }
    })();

    // Fire-and-forget #3: release the off-screen NPC↔NPC events that have now
    // occurred by this in-game day — writes episodic memories to both NPCs,
    // applies the relationship deltas to npc_npc_relationships, and logs system
    // relationship_events. Non-blocking; the clock must not wait on embeddings.
    void releaseEventsForDay(playerId, inGameDay).catch((e) =>
      console.error("advance-day inter-NPC event release failed:", e),
    );

    return NextResponse.json({ in_game_day: inGameDay });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to advance day: ${messageText}` },
      { status: 500 },
    );
  }
}
