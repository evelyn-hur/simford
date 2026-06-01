/**
 * Verify identity-relevance matching (word-boundary regex).
 *
 * Runs the real computeIdentityRelevance against synthetic edge cases (to prove
 * false positives are gone) and a sample of Jake's actual memories.
 *
 * Run with: npx tsx scripts/test-identity-relevance.ts
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { npcs } from "../data/npcs";
import {
  buildKeywordMatchers,
  computeIdentityRelevance,
} from "../lib/identityRelevance";

config({ path: resolve(process.cwd(), ".env.local") });

const jake = npcs.find((n) => n.id === "jake")!;
const keywords = jake.identity_keywords.filter(Boolean);
const matchers = buildKeywordMatchers(keywords);

function report(label: string, content: string) {
  const matched = keywords.filter((_, i) => matchers[i].test(content));
  const score = computeIdentityRelevance(content, matchers);
  console.log(`${label}  rel=${score.toFixed(2)}  [${matched.join(", ")}]`);
  console.log(`    "${content}"`);
}

// Edge cases: each comment is the behavior we want to confirm.
const SYNTHETIC: [string, string][] = [
  ["false-pos? ", "I really value our friendship and our relationship."], // ship must NOT match
  ["false-pos? ", "She got great advice from a service rep."], // vc must NOT match
  ["phrase    ", "He joined Cardinal Ventures as their newest founder."], // "cardinal ventures" + founder
  ["plural    ", "We talked about VCs and a YC batch."], // VC whole-word? plural excluded; YC matches
  ["inflection", "I finally shipped the build; the startup is live."], // build+startup yes, "shipped" no
  ["neutral   ", "Just chatting about the weather today."], // none
];

async function main() {
  console.log(`Keywords: ${keywords.join(", ")}\n`);

  console.log("== Synthetic edge cases ==");
  for (const [label, content] of SYNTHETIC) report(label, content);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("\n(skipping live memories — Supabase env not set)");
    return;
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await supabase
    .from("memory_stream")
    .select("content")
    .eq("npc_id", "jake")
    .order("created_at", { ascending: false })
    .limit(8);

  console.log("\n== Sample of Jake's real memories ==");
  for (const m of data ?? []) report("memory    ", m.content as string);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
