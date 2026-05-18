/**
 * Sanity-check the Smallville retrieval formula (match_memories).
 *
 * Seeds 5 sample memories with controlled importance + recency under an
 * isolated test NPC, then queries "I'm stressed about school" and prints the
 * ranked results with the three component scores broken out.
 *
 * Run with: npx tsx scripts/test-memory.ts
 *
 * Notes:
 * - Memories are inserted directly (not via writeEpisodicMemory) so the
 *   importance values below are exactly what we specify rather than
 *   re-scored by Claude.
 * - `recency` in the SQL formula decays on `created_at`, so the simulated
 *   ages are written to `created_at` (in_game_timestamp mirrors it).
 * - Isolated under npc_id `__memtest__`; re-running wipes prior test rows.
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.local") });

const TEST_NPC = "__memtest__";
const QUERY_TEXT = "I'm stressed about school";

const SAMPLES: { content: string; importance: number; ageHours: number }[] = [
  {
    content:
      "The player mentioned being worried about their CS161 midterm next week.",
    importance: 7,
    ageHours: 0,
  },
  {
    content:
      "The player shared they're considering dropping pre-med, their parents don't know.",
    importance: 9,
    ageHours: 48, // 2 days ago
  },
  {
    content: "The player said hi and asked about the weather.",
    importance: 2,
    ageHours: 1,
  },
  {
    content:
      "The player and I talked about my startup Lexora and they had thoughtful feedback.",
    importance: 6,
    ageHours: 120, // 5 days ago
  },
  {
    content: "The player mentioned they like coffee.",
    importance: 3,
    ageHours: 0,
  },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
    process.exit(1);
  }

  const { generateEmbedding } = await import("../lib/embeddings");
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Ensure the test NPC exists (memory_stream.npc_id -> npcs.id FK).
  const { error: npcError } = await supabase.from("npcs").upsert(
    {
      id: TEST_NPC,
      name: "Memory Test NPC",
      archetype: "test fixture",
      identity_prompt: "Test fixture for memory retrieval. Not a real NPC.",
      speaking_style: "n/a",
      values_json: {},
    },
    { onConflict: "id" },
  );
  if (npcError) {
    console.error("Failed to upsert test NPC:", npcError.message);
    process.exit(1);
  }

  // Idempotent: clear prior test memories.
  await supabase.from("memory_stream").delete().eq("npc_id", TEST_NPC);

  // Seed sample memories with controlled importance + created_at.
  console.log(`Seeding ${SAMPLES.length} test memories...`);
  for (const s of SAMPLES) {
    const embedding = await generateEmbedding(s.content);
    const createdAt = new Date(
      Date.now() - s.ageHours * 3600 * 1000,
    ).toISOString();

    const { error } = await supabase.from("memory_stream").insert({
      npc_id: TEST_NPC,
      memory_type: "episodic",
      content: s.content,
      importance: s.importance,
      embedding,
      created_at: createdAt,
      in_game_timestamp: createdAt,
    });
    if (error) {
      console.error(`  insert failed: ${error.message}`);
      process.exit(1);
    }
  }

  // Query.
  console.log(`\nQuery: "${QUERY_TEXT}"\n`);
  const queryEmbedding = await generateEmbedding(QUERY_TEXT);
  const { data, error } = await supabase.rpc("match_memories", {
    p_npc_id: TEST_NPC,
    p_query_embedding: queryEmbedding,
    p_top_k: 5,
  });

  if (error) {
    console.error("match_memories RPC failed:", error.message);
    process.exit(1);
  }

  const rows = data as {
    content: string;
    importance: number;
    created_at: string;
    similarity: number;
    importance_norm: number;
    recency: number;
    composite_score: number;
  }[];

  console.log("Ranked results (composite_score DESC):\n");
  rows.forEach((r, i) => {
    const ageH =
      (Date.now() - new Date(r.created_at).getTime()) / 3_600_000;
    const ageLabel =
      ageH < 1.5
        ? "now"
        : ageH < 48
          ? `${ageH.toFixed(0)}h ago`
          : `${(ageH / 24).toFixed(1)}d ago`;
    console.log(`#${i + 1}  composite=${r.composite_score.toFixed(4)}`);
    console.log(`    "${r.content}"`);
    console.log(
      `    similarity=${r.similarity.toFixed(4)}  ` +
        `importance=${r.importance}/10 (${r.importance_norm.toFixed(2)})  ` +
        `recency=${r.recency.toFixed(4)} [${ageLabel}]`,
    );
    console.log("");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
