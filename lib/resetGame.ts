import type { SupabaseClient } from "@supabase/supabase-js";
import { npcRelationships } from "@/data/npc_relationships";

// supabase-js requires a filter on delete/update-all; every real row's id differs
// from the nil UUID, so `.neq("id", NIL_UUID)` means "all rows".
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export interface ResetSummary {
  relationshipEvents: number;
  playerNpcRelationships: number;
  memoryStream: number;
  messages: number;
  conversations: number;
  interNpcEvents: number;
  npcNpcRelationships: number;
}

function chk(label: string, res: { error: { message: string } | null }): void {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
}

function countOf(res: { count: number | null; error: { message: string } | null }): number {
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
}

/**
 * Restore npc_npc_relationships from the immutable priors snapshot. This RESETS
 * the live values back to the seeded baseline — it never deletes the seeded
 * relationships. Bootstraps the snapshot from data/npc_relationships.ts if empty
 * (NOT from the live table, which has drifted as inter-NPC events released).
 */
async function restorePriors(supabase: SupabaseClient): Promise<number> {
  const { data: existing, error } = await supabase
    .from("npc_npc_relationships_priors")
    .select("npc_a_id, npc_b_id, trust, respect, vibe, archetype_affinity_prior");
  if (error) {
    throw new Error(
      "npc_npc_relationships_priors not found — apply the 20260603010000 priors " +
        `migration first (${error.message})`,
    );
  }

  let priors = (existing ?? []) as Array<{
    npc_a_id: string;
    npc_b_id: string;
    trust: number;
    respect: number;
    vibe: number;
    archetype_affinity_prior: number;
  }>;

  if (priors.length === 0) {
    const seed = npcRelationships.map(({ notes: _notes, ...row }) => row);
    chk(
      "bootstrap priors snapshot",
      await supabase
        .from("npc_npc_relationships_priors")
        .upsert(seed, { onConflict: "npc_a_id,npc_b_id" }),
    );
    priors = seed;
  }

  const now = new Date().toISOString();
  const rows = priors.map((p) => ({ ...p, last_updated: now }));
  chk(
    "restore npc_npc_relationships",
    await supabase
      .from("npc_npc_relationships")
      .upsert(rows, { onConflict: "npc_a_id,npc_b_id" }),
  );
  return priors.length;
}

/**
 * Reset one player's game while PRESERVING the seeded foundation — NPCs, their
 * relationship priors, and the generated inter-NPC events. Wipes only what
 * accrues during play (conversations, messages, memories, player relationships,
 * the day clock). npc_npc_relationships is RESTORED from the priors snapshot
 * (never deleted); inter_npc_events are only marked unprocessed, never deleted.
 *
 * Mirrors scripts/reset-game.ts so the in-app restart button and the CLI behave
 * identically. Some wipes are GLOBAL (memory_stream, the inter_npc_events
 * processed flag, system relationship_events) because that state is global in
 * this single-player build.
 */
export async function resetPlayer(
  supabase: SupabaseClient,
  playerId: string,
): Promise<ResetSummary> {
  // Conversation ids for this player (needed to wipe their messages).
  const { data: convs, error: convErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("player_id", playerId);
  if (convErr) throw new Error(`list conversations: ${convErr.message}`);
  const convIds = (convs ?? []).map((c) => c.id as string);

  // Counts captured BEFORE the deletes, for the summary.
  const relEvents = countOf(
    await supabase
      .from("relationship_events")
      .select("*", { count: "exact", head: true })
      .or(`player_id.eq.${playerId},player_id.is.null`),
  );
  const pnr = countOf(
    await supabase
      .from("player_npc_relationships")
      .select("*", { count: "exact", head: true })
      .eq("player_id", playerId),
  );
  const mem = countOf(
    await supabase.from("memory_stream").select("*", { count: "exact", head: true }),
  );
  const msgs = convIds.length
    ? countOf(
        await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .in("conversation_id", convIds),
      )
    : 0;
  const interEvents = countOf(
    await supabase.from("inter_npc_events").select("*", { count: "exact", head: true }),
  );

  // Mutations, in FK-safe order.
  chk(
    "delete relationship_events (player)",
    await supabase.from("relationship_events").delete().eq("player_id", playerId),
  );
  chk(
    "delete relationship_events (system)",
    await supabase.from("relationship_events").delete().is("player_id", null),
  );
  chk(
    "delete player_npc_relationships",
    await supabase.from("player_npc_relationships").delete().eq("player_id", playerId),
  );
  chk(
    "clear memory_stream",
    await supabase.from("memory_stream").delete().neq("id", NIL_UUID),
  );
  if (convIds.length) {
    chk(
      "delete messages",
      await supabase.from("messages").delete().in("conversation_id", convIds),
    );
  }
  chk(
    "delete conversations",
    await supabase.from("conversations").delete().eq("player_id", playerId),
  );
  chk(
    "reset game_state",
    await supabase.from("game_state").upsert(
      { player_id: playerId, in_game_day: 1, last_advanced_at: new Date().toISOString() },
      { onConflict: "player_id" },
    ),
  );
  // Re-arm every off-screen event WITHOUT deleting it (the seed is preserved).
  chk(
    "unprocess inter_npc_events",
    await supabase.from("inter_npc_events").update({ processed: false }).neq("id", NIL_UUID),
  );

  const npcNpc = await restorePriors(supabase);

  return {
    relationshipEvents: relEvents,
    playerNpcRelationships: pnr,
    memoryStream: mem,
    messages: msgs,
    conversations: convIds.length,
    interNpcEvents: interEvents,
    npcNpcRelationships: npcNpc,
  };
}
