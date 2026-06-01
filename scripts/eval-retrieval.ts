/**
 * Eval retrieval composite weights for memory ranking.
 *
 * Seeds 15 Jake-flavored memories on an isolated test NPC (varied topic,
 * importance, in-game day, with two `semantic` rows), then runs 5 queries
 * across 5 weight configurations against match_memories directly and prints
 * the top-5 per config so you can eyeball which weighting feels best.
 *
 * SQL composite: w_sim*similarity + w_imp*importance_norm + w_rec*recency.
 * Note: semantic memories get a fixed +0.1 importance_norm bonus inside
 * match_memories — visible as imp_norm > raw importance/10 in the output
 * (not printed separately here, but you'll see semantic rows out-rank
 * episodic ones of similar raw stats).
 *
 * Run with: npx tsx scripts/eval-retrieval.ts
 */

import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { inGameTimestampForDay } from "../lib/gameTime";

dotenvConfig({ path: resolve(process.cwd(), ".env.local") });

const TEST_NPC = "__evaltest__";
const TODAY_DAY = 7;

interface SeedMemory {
  content: string;
  importance: number;
  dayOffset: number; // 0 = today, 1 = yesterday, ...
  memoryType?: "episodic" | "semantic";
}

const SEED_MEMORIES: SeedMemory[] = [
  // Intellectual / career — high relevance to startup/founder queries.
  {
    content:
      "The player pushed back hard on my Lexora TAM numbers — they spotted the double-counting in our user funnel before I even mentioned it.",
    importance: 9,
    dayOffset: 2,
  },
  {
    content:
      "The player mentioned they're prepping a YC W26 application for their own dev tools startup.",
    importance: 7,
    dayOffset: 1,
  },
  {
    content:
      "The player and I geeked out over B2B distribution strategy and they had a sharp point about wedge versus moat.",
    importance: 7,
    dayOffset: 2,
  },
  {
    content:
      "The player asked thoughtful questions about how I structured the Cardinal Ventures cohort interviews.",
    importance: 6,
    dayOffset: 4,
  },

  // Vulnerability / family / stakes — high importance, older.
  {
    content:
      "The player admitted they're considering dropping their CS major and they're terrified of telling their parents.",
    importance: 10,
    dayOffset: 3,
  },
  {
    content:
      "The player shared they have a recurring dream about their dad disowning them after they fail an exam.",
    importance: 9,
    dayOffset: 5,
  },
  {
    content:
      "The player has a CS161 midterm next week and they're spiraling about it — convinced they'll bomb it.",
    importance: 7,
    dayOffset: 1,
  },

  // Mid-importance personal observations.
  {
    content:
      "The player said they pull all-nighters in Green Library most of midterms week, surviving on Coupa cold brew.",
    importance: 4,
    dayOffset: 5,
  },
  {
    content:
      "The player asked what week of the quarter it was, which gave them away — they were procrastinating their problem set.",
    importance: 3,
    dayOffset: 3,
  },
  {
    content:
      "The player called me out for being too self-promotional in conversation and it stung — they were right.",
    importance: 8,
    dayOffset: 4,
  },

  // Trivial small talk — recent, very low importance.
  {
    content: "The player asked how my day was going. I said busy.",
    importance: 2,
    dayOffset: 0,
  },
  {
    content:
      "The player commented that the weather has been unusually warm for late September in Palo Alto.",
    importance: 1,
    dayOffset: 0,
  },
  {
    content:
      "The player and I met at Coupa Café and they bought my latte without asking — small gesture but it landed.",
    importance: 3,
    dayOffset: 6,
  },

  // Two SEMANTIC consolidated insights.
  {
    content:
      "The player has real founder instincts but doesn't yet trust their own judgment — they keep looking for permission to do the thing they already want to do.",
    importance: 7,
    dayOffset: 1,
    memoryType: "semantic",
  },
  {
    content:
      "Under the ambition there's a deep need to prove themselves to their family — that's the real engine, not the love of building.",
    importance: 9,
    dayOffset: 2,
    memoryType: "semantic",
  },
];

const QUERIES = [
  "I'm stressed about my CS161 midterm",
  "What did you think about my startup pitch?",
  "Tell me what you remember about me",
  "I'm thinking of dropping out of Stanford",
  "Should I apply to YC?",
];

interface WeightConfig {
  label: string;
  w_sim: number;
  w_imp: number;
  w_rec: number;
}

const CONFIGS: WeightConfig[] = [
  { label: "baseline   1.0/1.0/1.0", w_sim: 1.0, w_imp: 1.0, w_rec: 1.0 },
  { label: "sim-heavy  1.5/1.0/0.5", w_sim: 1.5, w_imp: 1.0, w_rec: 0.5 },
  { label: "imp-heavy  1.0/1.5/0.7", w_sim: 1.0, w_imp: 1.5, w_rec: 0.7 },
  { label: "rec-heavy  0.7/0.7/1.5", w_sim: 0.7, w_imp: 0.7, w_rec: 1.5 },
  { label: "sim-only   1.0/0.0/0.0", w_sim: 1.0, w_imp: 0.0, w_rec: 0.0 },
];

interface MatchRow {
  memory_type: string;
  content: string;
  importance: number;
  in_game_timestamp: string;
  similarity: number;
  importance_norm: number;
  recency: number;
  composite_score: number;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { generateEmbedding } = await import("../lib/embeddings");

  // Ensure the test NPC exists (FK target).
  const { error: npcError } = await supabase.from("npcs").upsert(
    {
      id: TEST_NPC,
      name: "Retrieval Eval NPC",
      archetype: "test fixture",
      identity_prompt: "Test fixture for retrieval eval. Not a real NPC.",
      speaking_style: "n/a",
    },
    { onConflict: "id" },
  );
  if (npcError) {
    console.error("Failed to upsert test NPC:", npcError.message);
    process.exit(1);
  }

  // Wipe prior test memories — idempotent across re-runs.
  await supabase.from("memory_stream").delete().eq("npc_id", TEST_NPC);

  console.log(
    `Seeding ${SEED_MEMORIES.length} memories on '${TEST_NPC}' (today = in-game Day ${TODAY_DAY})...`,
  );
  for (const m of SEED_MEMORIES) {
    const embedding = await generateEmbedding(m.content);
    const day = TODAY_DAY - m.dayOffset;
    const ig = inGameTimestampForDay(day);
    const { error } = await supabase.from("memory_stream").insert({
      npc_id: TEST_NPC,
      memory_type: m.memoryType ?? "episodic",
      content: m.content,
      importance: m.importance,
      embedding,
      in_game_timestamp: ig,
    });
    if (error) {
      console.error(`  insert failed: ${error.message}`);
      process.exit(1);
    }
  }
  console.log("Seed complete.");

  const nowInGame = inGameTimestampForDay(TODAY_DAY);
  const nowMs = new Date(nowInGame).getTime();
  const DAY_MS = 86_400_000;

  for (const query of QUERIES) {
    console.log(
      `\n====================================================================`,
    );
    console.log(`== Query: "${query}"`);
    console.log(
      `====================================================================`,
    );
    const qEmb = await generateEmbedding(query);
    for (const cfg of CONFIGS) {
      const { data, error } = await supabase.rpc("match_memories", {
        p_npc_id: TEST_NPC,
        p_query_embedding: qEmb,
        p_top_k: 5,
        p_w_similarity: cfg.w_sim,
        p_w_importance: cfg.w_imp,
        p_w_recency: cfg.w_rec,
        p_now_in_game: nowInGame,
      });
      if (error) {
        console.error(`\n  [${cfg.label}] rpc error: ${error.message}`);
        continue;
      }
      console.log(`\n  [${cfg.label}]`);
      (data as MatchRow[]).forEach((r, i) => {
        const memMs = new Date(r.in_game_timestamp).getTime();
        const daysAgo = Math.round((nowMs - memMs) / DAY_MS);
        const tag = r.memory_type === "semantic" ? "sem" : "ep ";
        const content =
          r.content.length > 78 ? r.content.slice(0, 78) + "…" : r.content;
        console.log(
          `    #${i + 1}  comp=${r.composite_score.toFixed(3)}  ` +
            `imp=${r.importance.toString().padStart(2)}  ` +
            `sim=${r.similarity.toFixed(2)}  ` +
            `rec=${r.recency.toFixed(2)}  ` +
            `Δ=${daysAgo}d  ${tag}`,
        );
        console.log(`         "${content}"`);
      });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
