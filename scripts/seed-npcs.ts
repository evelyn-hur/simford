/**
 * Seed the `npcs` table.
 *
 * Run with: npx tsx scripts/seed-npcs.ts
 *
 * Uses the Supabase SERVICE ROLE key directly (not the lib/supabase clients,
 * which depend on `next/headers` and only work inside a Next request). The
 * service role key bypasses RLS, which is required here because RLS is enabled
 * on `npcs` with no insert policy for the anon role.
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { npcs } from "../data/npcs";

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
  console.log(`Seeding ${npcs.length} NPC(s)...`);

  // Upsert so the script is idempotent (safe to re-run).
  const { data, error } = await supabase
    .from("npcs")
    .upsert(npcs, { onConflict: "id" })
    .select("id, name, archetype");

  if (error) {
    console.error("Seed failed:", error.message);
    process.exit(1);
  }

  for (const npc of data ?? []) {
    console.log(`  ✓ ${npc.id} — ${npc.name} (${npc.archetype})`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
