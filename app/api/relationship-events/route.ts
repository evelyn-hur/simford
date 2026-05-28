import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const LIMIT = 10;

/**
 * Recent relationship_events for the player↔NPC pair behind a conversation.
 * GET /api/relationship-events?npcId=...&conversationId=...
 * Player is derived from the conversation (consistent with the chat route).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const npcId = searchParams.get("npcId");
  const conversationId = searchParams.get("conversationId");

  if (!npcId || !conversationId) {
    return NextResponse.json(
      { error: "npcId and conversationId are required" },
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
    return NextResponse.json({ events: [] });
  }

  const { data, error } = await supabase
    .from("relationship_events")
    .select("delta_trust, delta_respect, delta_vibe, reasoning, created_at")
    .eq("player_id", playerId)
    .eq("npc_id", npcId)
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ events: data ?? [] });
}
