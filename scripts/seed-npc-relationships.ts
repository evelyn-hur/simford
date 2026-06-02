/**
 * Seed the `npc_npc_relationships` table with the initial NPC↔NPC priors.
 *
 * Run with: npx tsx scripts/seed-npc-relationships.ts
 *
 * Uses the Supabase SERVICE ROLE key directly (same rationale as
 * scripts/seed-npcs.ts — RLS is enabled with no insert policy for anon).
 *
 * The priors are undirected (one row per unordered pair). `notes` in the source
 * data is design documentation only — `npc_npc_relationships` has no notes
 * column, so it is stripped before upsert.
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

async function main() {
  // Strip `notes` — it's documentation, not a table column.
  const rows = npcRelationships.map(({ notes: _notes, ...row }) => row);

  console.log(`Seeding ${rows.length} NPC↔NPC relationship prior(s)...`);

  // Upsert so the script is idempotent (safe to re-run).
  const { data, error } = await supabase
    .from("npc_npc_relationships")
    .upsert(rows, { onConflict: "npc_a_id,npc_b_id" })
    .select("npc_a_id, npc_b_id");

  if (error) {
    console.error("Seed failed:", error.message);
    process.exit(1);
  }

  console.log(`  ✓ Upserted ${data?.length ?? 0} pair(s).`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
