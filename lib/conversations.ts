import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { DEV_PLAYER_ID, DEV_PLAYER_NAME } from "@/lib/dev";

export interface ChatMessage {
  role: "player" | "npc";
  content: string;
}

/**
 * Returns the most recent conversation between the dev player and an NPC,
 * creating one (and the dev player row) if none exists yet.
 *
 * Uses the service-role client because RLS is enabled with no anon policies.
 */
export async function getOrCreateConversation(npcId: string): Promise<string> {
  const supabase = createServiceRoleClient();

  // Ensure the dev player exists — it is the FK target for conversations.
  const { error: playerError } = await supabase
    .from("players")
    .upsert(
      { id: DEV_PLAYER_ID, display_name: DEV_PLAYER_NAME },
      { onConflict: "id" },
    );
  if (playerError) {
    throw new Error(`Failed to ensure dev player: ${playerError.message}`);
  }

  // Reuse the latest conversation for this player+npc for continuity.
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("player_id", DEV_PLAYER_ID)
    .eq("npc_id", npcId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id as string;

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ player_id: DEV_PLAYER_ID, npc_id: npcId })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(
      `Failed to create conversation: ${error?.message ?? "unknown error"}`,
    );
  }
  return created.id as string;
}

export async function getMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load messages: ${error.message}`);
  }

  return (data ?? []).map((m) => ({
    role: m.role as "player" | "npc",
    content: m.content as string,
  }));
}
