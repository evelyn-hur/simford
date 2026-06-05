/**
 * Blind rating interface for human_rated evaluation scenarios.
 *
 * Reads the eval result JSON files in evaluation/results/, collects every run
 * whose evaluation_method is `human_rated`, and presents them one at a time —
 * in RANDOM order, with the mode (system vs baseline) HIDDEN — so your ratings
 * aren't biased by knowing which version you're looking at. You rate each 1–5
 * and give a one-sentence reason. The modes are revealed only after you finish,
 * and everything is saved to evaluation/results/human_ratings_<name>.json.
 *
 * Usage:
 *   npm run rate                       # prompts for your name
 *   npm run rate -- --name eve         # set the name up front
 *   npm run rate -- --list             # preview what would be rated, then exit
 *
 * For a real blind A/B, generate BOTH modes first:
 *   npm run eval -- --all --mode system
 *   npm run eval -- --all --mode baseline
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

const RESULTS_DIR = join(process.cwd(), "evaluation", "results");

interface Item {
  scenarioId: string;
  mode: string;
  repeat: number;
  dimension: string;
  npc: string;
  playerMessage: string;
  npcResponse: string;
  ratingGuide: string[];
  sourceFinishedAt: string;
}

/** Collect human_rated runs from result files, keeping the latest per
 *  (scenario, mode, repeat). */
function loadItems(): Item[] {
  if (!existsSync(RESULTS_DIR)) return [];
  const files = readdirSync(RESULTS_DIR).filter(
    (f) => f.endsWith(".json") && !f.startsWith("human_ratings_"),
  );
  const byKey = new Map<string, Item>();

  for (const f of files) {
    let rep: { meta?: { finishedAt?: string; startedAt?: string }; runs?: unknown[] };
    try {
      rep = JSON.parse(readFileSync(join(RESULTS_DIR, f), "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(rep.runs)) continue;
    const finishedAt =
      rep.meta?.finishedAt ??
      rep.meta?.startedAt ??
      statSync(join(RESULTS_DIR, f)).mtime.toISOString();

    for (const raw of rep.runs) {
      const r = raw as {
        scenarioId: string;
        mode: string;
        repeat: number;
        dimension: string;
        npcs?: string[];
        evaluationMethod: string;
        probe?: { query?: string } | null;
        captured?: {
          primaryResponse?: string | null;
          responsesByNpc?: Record<string, { reply?: string }>;
        };
        evaluation?: { details?: { rating_dimensions?: string[] } };
      };
      if (r.evaluationMethod !== "human_rated") continue;

      const response =
        r.captured?.primaryResponse ??
        (r.captured?.responsesByNpc
          ? Object.values(r.captured.responsesByNpc)[0]?.reply
          : undefined) ??
        null;
      if (!response) continue; // nothing to rate

      const key = `${r.scenarioId}|${r.mode}|${r.repeat}`;
      const existing = byKey.get(key);
      if (existing && existing.sourceFinishedAt >= finishedAt) continue; // keep latest

      byKey.set(key, {
        scenarioId: r.scenarioId,
        mode: r.mode,
        repeat: r.repeat,
        dimension: r.dimension,
        npc: r.npcs?.[0] ?? "?",
        playerMessage: r.probe?.query ?? "(no probe message)",
        npcResponse: response,
        ratingGuide: r.evaluation?.details?.rating_dimensions ?? [],
        sourceFinishedAt: finishedAt,
      });
    }
  }
  return Array.from(byKey.values());
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const items = loadItems();

  if (items.length === 0) {
    console.log("No human_rated responses found in evaluation/results/.");
    console.log("Run the eval first, e.g.:");
    console.log("  npm run eval -- --all --mode system");
    console.log("  npm run eval -- --all --mode baseline   (for a blind A/B)");
    return;
  }

  const modes = Array.from(new Set(items.map((i) => i.mode))).sort();

  if (process.argv.includes("--list")) {
    console.log(`${items.length} human_rated response(s) available:`);
    for (const m of modes) {
      const ids = items.filter((i) => i.mode === m).map((i) => i.scenarioId);
      console.log(`  ${m}: ${ids.length} — ${ids.join(", ")}`);
    }
    return;
  }

  // Line-queue over classic readline — robust for both interactive TTY input
  // and piped/non-TTY input (readline/promises' question() mishandles the latter).
  const rl = readline.createInterface({ input });
  const queue: string[] = [];
  const waiters: Array<(s: string | null) => void> = [];
  let inputClosed = false;
  rl.on("line", (line) => {
    const w = waiters.shift();
    if (w) w(line);
    else queue.push(line);
  });
  rl.on("close", () => {
    inputClosed = true;
    while (waiters.length) (waiters.shift() as (s: string | null) => void)(null);
  });
  const ask = (prompt: string): Promise<string | null> => {
    output.write(prompt);
    if (queue.length) return Promise.resolve(queue.shift() as string);
    if (inputClosed) return Promise.resolve(null);
    return new Promise((res) => waiters.push(res));
  };

  let name = arg("--name");
  if (!name) {
    name = ((await ask("Your name (for the ratings filename): ")) ?? "").trim();
  }
  name = name || "anon";

  console.log(
    `\n${items.length} response(s) to rate (${modes
      .map((m) => `${items.filter((i) => i.mode === m).length} ${m}`)
      .join(", ")}).`,
  );
  if (modes.length < 2) {
    console.log(
      "⚠  Only one mode is present. For a true blind A/B, run both " +
        "`--mode system` and `--mode baseline` first.",
    );
  }
  console.log(
    "\nModes are HIDDEN until you finish — rate each on a 1–5 scale and give a " +
      "one-sentence reason. They are shown in random order.\n",
  );

  const shuffled = shuffle(items);
  const ratings: Array<Item & { rating: number; reason: string }> = [];

  for (let i = 0; i < shuffled.length; i++) {
    const it = shuffled[i];
    console.log("─".repeat(72));
    console.log(`[${i + 1}/${shuffled.length}]  ${it.scenarioId}   (npc: ${it.npc})`);
    if (it.ratingGuide.length) {
      console.log("  rate on: " + it.ratingGuide.join("  |  "));
    }
    console.log(`\n  Player: ${it.playerMessage}`);
    console.log(`\n  NPC:    ${it.npcResponse}\n`);

    let rating = NaN;
    let aborted = false;
    while (!(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
      const ans = await ask("  Rating (1-5): ");
      if (ans === null) {
        aborted = true;
        break;
      }
      rating = parseInt(ans.trim(), 10);
      if (!(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
        console.log("  Please enter a whole number from 1 to 5.");
      }
    }
    if (aborted) break;
    const reasonAns = await ask("  One-sentence reason: ");
    if (reasonAns === null) break;
    ratings.push({ ...it, rating, reason: reasonAns.trim() });
    console.log("");
  }

  rl.close();

  // ── Reveal the modes (only now) ─────────────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("  RESULTS — modes revealed");
  console.log("=".repeat(72));
  for (const r of ratings) {
    console.log(
      `  ${r.rating}/5  [${r.mode.padEnd(8)}] ${r.scenarioId.padEnd(40)} ${r.reason}`,
    );
  }
  console.log("");
  for (const m of modes) {
    const rs = ratings.filter((r) => r.mode === m).map((r) => r.rating);
    if (rs.length) {
      const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
      console.log(`  ${m.padEnd(8)} mean: ${mean.toFixed(2)}  (n=${rs.length})`);
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  mkdirSync(RESULTS_DIR, { recursive: true });
  const safe = name.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase() || "anon";
  const outPath = join(RESULTS_DIR, `human_ratings_${safe}.json`);
  const payload = {
    rater: name,
    ratedAt: new Date().toISOString(),
    count: ratings.length,
    ratings: ratings.map(({ sourceFinishedAt: _drop, ...keep }) => keep),
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`\n  Saved ${ratings.length} ratings to ${outPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
