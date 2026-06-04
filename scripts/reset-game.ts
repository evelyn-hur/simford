/**
 * Per-player game reset that preserves the seeded foundation (NPCs, their
 * relationship priors, and the generated inter-NPC events) while wiping
 * everything that accrues during play.
 *
 * Run with:
 *   npx tsx scripts/reset-game.ts --player-id <uuid>
 *   npx tsx scripts/reset-game.ts --player-id <uuid> --dry-run   # preview only, no writes
 *
 * SAFETY
 * - --player-id is REQUIRED; the script refuses to run without it, and refuses
 *   if no such player exists — a typo'd id would otherwise still trigger the
 *   GLOBAL wipes below.
 * - Some wipes are GLOBAL, not per-player, because the underlying state is
 *   global in this single-player build:
 *     • memory_stream is cleared ENTIRELY (memories mix player-conversation and
 *       inter-NPC-event sources — easier to wipe the whole stream),
 *     • every inter_npc_event is marked unprocessed (the `processed` flag is
 *       global, not per-player),
 *     • system relationship_events (player_id IS NULL) are cleared.
 *
 * npc_npc_relationships is restored from `npc_npc_relationships_priors` — an
 * immutable snapshot created by the 20260603010000 migration. If that snapshot
 * is empty (first reset), it's bootstrapped from data/npc_relationships.ts (the
 * canonical prior source), NOT from the current live table, which has already
 * drifted as inter-NPC events released.
 *
 * Uses the Supabase SERVICE ROLE key directly (RLS bypass), like the seed scripts.
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { npcRelationships } from "../data/npc_relationships";

// Load .env.local explicitly (dotenv defaults to .env).
config({ path: resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Every real row's id differs from the nil UUID — the filter that means "all
// rows" for delete/update-all (supabase-js requires a filter on those).
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function parsePlayerId(): string {
  const i = process.argv.indexOf("--player-id");
  const val = i === -1 ? undefined : process.argv[i + 1];
  if (!val || val.startsWith("--")) {
    console.error(
      "Refusing to run: --player-id <id> is required.\n" +
        "Usage: npx tsx scripts/reset-game.ts --player-id <uuid> [--dry-run]",
    );
    process.exit(1);
  }
  return val;
}

// Throw on a Supabase error result (delete/update/upsert).
function chk(label: string, res: { error: { message: string } | null }): void {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
}

// Pull the count out of a head+count query result, throwing on error.
function getCount(
  label: string,
  res: { count: number | null; error: { message: string } | null },
): number {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.count ?? 0;
}

/**
 * Restore npc_npc_relationships from the priors snapshot. Bootstraps the
 * snapshot from data/npc_relationships.ts if it's empty. Returns the pair count.
 */
async function restorePriors(dryRun: boolean): Promise<number> {
  const { data: existing, error } = await supabase
    .from("npc_npc_relationships_priors")
    .select("npc_a_id, npc_b_id, trust, respect, vibe, archetype_affinity_prior");
  if (error) {
    throw new Error(
      "npc_npc_relationships_priors not found — apply the " +
        `20260603010000_npc_npc_relationships_priors migration first (${error.message})`,
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
    // Bootstrap from the canonical seed data (NOT the live table, which has
    // drifted as inter-NPC events released). `notes` is documentation only.
    const seed = npcRelationships.map(({ notes: _notes, ...row }) => row);
    if (dryRun) {
      console.log(
        `  (priors snapshot empty — would bootstrap ${seed.length} pairs from data/npc_relationships.ts)`,
      );
    } else {
      chk(
        "bootstrap priors snapshot",
        await supabase
          .from("npc_npc_relationships_priors")
          .upsert(seed, { onConflict: "npc_a_id,npc_b_id" }),
      );
      console.log(
        `  (bootstrapped priors snapshot from data/npc_relationships.ts — ${seed.length} pairs)`,
      );
    }
    priors = seed;
  }

  if (!dryRun) {
    const now = new Date().toISOString();
    const rows = priors.map((p) => ({
      npc_a_id: p.npc_a_id,
      npc_b_id: p.npc_b_id,
      trust: p.trust,
      respect: p.respect,
      vibe: p.vibe,
      archetype_affinity_prior: p.archetype_affinity_prior,
      last_updated: now,
    }));
    chk(
      "restore npc_npc_relationships",
      await supabase
        .from("npc_npc_relationships")
        .upsert(rows, { onConflict: "npc_a_id,npc_b_id" }),
    );
  }

  return priors.length;
}

async function main() {
  const playerId = parsePlayerId();
  const dryRun = process.argv.includes("--dry-run");

  // Safety: the player must exist, or the GLOBAL wipes would fire for a bad id.
  const { data: player, error: playerErr } = await supabase
    .from("players")
    .select("id")
    .eq("id", playerId)
    .maybeSingle();
  if (playerErr) {
    console.error(`Failed to look up player: ${playerErr.message}`);
    process.exit(1);
  }
  if (!player) {
    console.error(
      `No player with id '${playerId}' exists. Refusing to run — the global ` +
        "wipes (memory_stream, inter_npc_events, NPC-NPC events) would still " +
        "execute for a non-existent id.",
    );
    process.exit(1);
  }

  if (dryRun) {
    console.log("DRY RUN — computing counts; no changes will be made.\n");
  }

  // ── Counts (captured BEFORE any deletes) ─────────────────────────────────
  const relPlayer = getCount(
    "count relationship_events (player)",
    await supabase
      .from("relationship_events")
      .select("*", { count: "exact", head: true })
      .eq("player_id", playerId),
  );
  const relSystem = getCount(
    "count relationship_events (system)",
    await supabase
      .from("relationship_events")
      .select("*", { count: "exact", head: true })
      .is("player_id", null),
  );
  const pnrCount = getCount(
    "count player_npc_relationships",
    await supabase
      .from("player_npc_relationships")
      .select("*", { count: "exact", head: true })
      .eq("player_id", playerId),
  );
  const memCount = getCount(
    "count memory_stream",
    await supabase.from("memory_stream").select("*", { count: "exact", head: true }),
  );

  const { data: convs, error: convErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("player_id", playerId);
  if (convErr) {
    console.error(`Failed to list conversations: ${convErr.message}`);
    process.exit(1);
  }
  const convIds = (convs ?? []).map((c) => c.id as string);
  let msgCount = 0;
  if (convIds.length > 0) {
    msgCount = getCount(
      "count messages",
      await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .in("conversation_id", convIds),
    );
  }

  const interCount = getCount(
    "count inter_npc_events",
    await supabase
      .from("inter_npc_events")
      .select("*", { count: "exact", head: true }),
  );

  // ── Mutations (skipped in dry run), in FK-safe order ─────────────────────
  if (!dryRun) {
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
      await supabase
        .from("player_npc_relationships")
        .delete()
        .eq("player_id", playerId),
    );
    chk(
      "clear memory_stream",
      await supabase.from("memory_stream").delete().neq("id", NIL_UUID),
    );
    if (convIds.length > 0) {
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
        {
          player_id: playerId,
          in_game_day: 1,
          last_advanced_at: new Date().toISOString(),
        },
        { onConflict: "player_id" },
      ),
    );
    chk(
      "unprocess inter_npc_events",
      await supabase
        .from("inter_npc_events")
        .update({ processed: false })
        .neq("id", NIL_UUID),
    );
  }

  const restored = await restorePriors(dryRun);

  // ── Confirmation ─────────────────────────────────────────────────────────
  const v = (done: string, would: string) => (dryRun ? would : done);
  console.log(
    dryRun
      ? `\nDRY RUN — would reset player ${playerId}:`
      : `\nReset complete for player ${playerId}:`,
  );
  console.log(
    `- ${v("Cleared", "Would clear")} ${relPlayer + relSystem} relationship_events (${relPlayer} player-driven, ${relSystem} NPC-NPC)`,
  );
  console.log(`- ${v("Cleared", "Would clear")} ${pnrCount} player_npc_relationships`);
  console.log(`- ${v("Cleared", "Would clear")} ${memCount} memory_stream entries`);
  console.log(
    `- ${v("Cleared", "Would clear")} ${msgCount} messages across ${convIds.length} conversations`,
  );
  console.log(`- ${v("Reset", "Would reset")} in_game_day to 1`);
  console.log(
    `- ${v("Marked", "Would mark")} ${interCount} inter_npc_events as unprocessed`,
  );
  console.log(
    `- ${v("Restored", "Would restore")} ${restored} npc_npc_relationships to priors`,
  );
  if (dryRun) console.log("\n(no changes were made)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
