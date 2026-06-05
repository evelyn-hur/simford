/**
 * Build the blind rating pool for the external /eval-rate survey.
 *
 * Harvests cultural-authenticity NPC responses from the eval result JSONs,
 * dedupes by (npc + response text), shuffles, and writes two files:
 *
 *   evaluation/external/pool.json        — CLIENT-FACING, mode STRIPPED. Each
 *                                          item: { id, npc, npcName, playerMessage,
 *                                          npcResponse }. This is what the webpage
 *                                          (and therefore raters) ever sees.
 *   evaluation/external/answer-key.json  — SERVER-SIDE ONLY. Maps each id back to
 *                                          { mode, scenarioId, npc, sourceFile } so
 *                                          ratings can be de-blinded for analysis.
 *
 * Keeping mode out of pool.json is what makes the survey blind — the page reads
 * pool.json, never the key.
 *
 * Usage:
 *   npx tsx scripts/build-eval-rate-pool.ts                 # all distinct responses
 *   npx tsx scripts/build-eval-rate-pool.ts --balanced      # cap each mode to the
 *                                                            # smaller mode's count
 *   npx tsx scripts/build-eval-rate-pool.ts --max 15        # cap total pool size
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const RESULTS_DIR = join(ROOT, "evaluation", "results");
const OUT_DIR = join(ROOT, "evaluation", "external");

// Source result files to harvest from (any that contain cultural runs).
const SOURCE_FILES = ["all-system.json", "baseline-all-system.json", "all-baseline.json"];

const NPC_NAMES: Record<string, string> = {
  marcus: "Marcus",
  june: "June",
  jake: "Jake",
  eliza: "Eliza",
};
const displayName = (id: string) =>
  NPC_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

interface Harvested {
  scenarioId: string;
  mode: string;
  npc: string;
  playerMessage: string;
  npcResponse: string;
  sourceFile: string;
}

function harvest(): Harvested[] {
  const seen = new Map<string, Harvested>();
  for (const f of SOURCE_FILES) {
    const p = join(RESULTS_DIR, f);
    if (!existsSync(p)) continue;
    let j: { runs?: unknown[] };
    try {
      j = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(j.runs)) continue;
    for (const raw of j.runs) {
      const r = raw as {
        scenarioId: string;
        mode: string;
        dimension: string;
        npcs?: string[];
        probe?: { query?: string } | null;
        captured?: {
          primaryResponse?: string | null;
          responsesByNpc?: Record<string, { reply?: string }>;
        };
      };
      if (r.dimension !== "cultural_authenticity") continue;
      const resp =
        r.captured?.primaryResponse ??
        (r.captured?.responsesByNpc
          ? Object.values(r.captured.responsesByNpc)[0]?.reply
          : undefined) ??
        null;
      if (!resp) continue;
      const npc = r.npcs?.[0] ?? "?";
      const key = `${npc}::${resp.trim()}`;
      if (seen.has(key)) continue; // dedupe identical responses across runs
      seen.set(key, {
        scenarioId: r.scenarioId,
        mode: r.mode,
        npc,
        playerMessage: r.probe?.query ?? "(no probe message)",
        npcResponse: resp.trim(),
        sourceFile: f,
      });
    }
  }
  return Array.from(seen.values());
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main() {
  let items = harvest();
  if (items.length === 0) {
    console.error("No cultural-authenticity responses found in evaluation/results/.");
    process.exit(1);
  }

  // Optional --balanced: cap each mode to the smaller mode's count so the pool
  // is an even system/baseline split (cleaner for an A/B comparison).
  if (process.argv.includes("--balanced")) {
    const byMode = new Map<string, Harvested[]>();
    for (const it of items) {
      (byMode.get(it.mode) ?? byMode.set(it.mode, []).get(it.mode)!).push(it);
    }
    const minN = Math.min(...Array.from(byMode.values(), (a) => a.length));
    items = Array.from(byMode.values()).flatMap((a) => shuffle(a).slice(0, minN));
  }

  let pool = shuffle(items);

  const max = argVal("--max");
  if (max && Number.isFinite(Number(max))) pool = pool.slice(0, Number(max));

  const generatedAt = new Date().toISOString();

  const publicItems = pool.map((it, i) => ({
    id: `resp-${String(i + 1).padStart(2, "0")}`,
    npc: it.npc,
    npcName: displayName(it.npc),
    playerMessage: it.playerMessage,
    npcResponse: it.npcResponse,
  }));

  const key: Record<string, { mode: string; scenarioId: string; npc: string; sourceFile: string }> = {};
  pool.forEach((it, i) => {
    key[`resp-${String(i + 1).padStart(2, "0")}`] = {
      mode: it.mode,
      scenarioId: it.scenarioId,
      npc: it.npc,
      sourceFile: it.sourceFile,
    };
  });

  const split: Record<string, number> = {};
  for (const it of pool) split[it.mode] = (split[it.mode] ?? 0) + 1;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, "pool.json"),
    JSON.stringify({ generatedAt, count: publicItems.length, items: publicItems }, null, 2),
  );
  writeFileSync(
    join(OUT_DIR, "answer-key.json"),
    JSON.stringify({ generatedAt, split, key }, null, 2),
  );

  console.log(`Wrote ${publicItems.length} responses to evaluation/external/pool.json`);
  console.log(`Mode split (hidden from raters):`, split);
  console.log(`Answer key: evaluation/external/answer-key.json`);
}

main();
