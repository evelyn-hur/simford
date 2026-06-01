import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { DEV_PLAYER_ID, DEV_PLAYER_NAME } from "@/lib/dev";
import { endConversation } from "@/lib/conversationEnd";

export interface ChatMessage {
  role: "player" | "npc";
  content: string;
  // Optional context — populated by getThreadMessages for cross-conversation
  // display (boundary dividers in the chat UI). The summarizer/memory paths
  // ignore these fields.
  conversationId?: string;
  inGameDay?: number | null;
}

/**
 * Returns the most recent ACTIVE conversation between the dev player and an
 * NPC, creating a new one (and the dev player row) if there isn't one.
 *
 * A conversation is "active" when `judged = false`. Once it's been ended via
 * `/api/conversation/end` (which sets judged=true), the next call here starts
 * a fresh conversation row instead of reusing the closed one — so returning
 * to an NPC whose last conversation was judged always begins a new session.
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

  // Reuse the latest UNJUDGED (active) conversation for this player+npc. If
  // the latest one is judged (already ended), fall through to creating a new
  // one — we do NOT resurrect closed conversations.
  const { data: existing } = await supabase
    .from("conversations")
    .select("id, judged")
    .eq("player_id", DEV_PLAYER_ID)
    .eq("npc_id", npcId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && !existing.judged) {
    // Reuse only if EMPTY (i.e., a fresh row from a recent render that the
    // user never typed into). Once a conversation has any messages, returning
    // to /chat/[npc] means a new session — close out the old one and start
    // fresh. This makes page load deterministic; we don't rely on the
    // beforeunload beacon having reached the server before the SSR runs.
    const { data: firstMsg } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", existing.id as string)
      .limit(1)
      .maybeSingle();

    if (!firstMsg) {
      return existing.id as string;
    }

    // Stale unjudged conversation with messages — kick off the judge
    // fire-and-forget. endConversation's atomic claim immediately flips
    // judged=true so the new conversation we create below is correctly
    // ranked as the latest active one; the Sonnet judge call completes
    // asynchronously and the relationship_events row lands a few seconds
    // later. Same serverless caveat as other fire-and-forget calls.
    void endConversation(existing.id as string).catch((err) =>
      console.error(
        "getOrCreateConversation: end of stale conv failed:",
        err,
      ),
    );
  }

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

/**
 * Full chronological message thread for a (player, NPC) pair, spanning ALL
 * conversations between them — past judged conversations and the current
 * open one. Each message carries `conversationId` and `inGameDay` so the UI
 * can render iMessage-style dividers between conversations / days.
 */
export async function getThreadMessages(
  playerId: string,
  npcId: string,
): Promise<ChatMessage[]> {
  const supabase = createServiceRoleClient();

  // First grab the conversation ids for this pair...
  const { data: convs, error: convError } = await supabase
    .from("conversations")
    .select("id")
    .eq("player_id", playerId)
    .eq("npc_id", npcId);
  if (convError) {
    throw new Error(`Failed to load conversations: ${convError.message}`);
  }
  const convIds = (convs ?? []).map((c) => c.id as string);
  if (convIds.length === 0) return [];

  // ...then all messages across those conversations, chronological.
  const { data, error } = await supabase
    .from("messages")
    .select("role, content, conversation_id, in_game_day, created_at")
    .in("conversation_id", convIds)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`Failed to load thread messages: ${error.message}`);
  }

  return (data ?? []).map((m) => ({
    role: m.role as "player" | "npc",
    content: m.content as string,
    conversationId: m.conversation_id as string,
    inGameDay: m.in_game_day as number | null,
  }));
}
