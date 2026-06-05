/**
 * Evaluation analysis report builder.
 *
 * Loads every evaluation result file in evaluation/results/, the scenario YAMLs
 * (for tags / NPC / dimension), and the human + external rater files, then writes
 * a structured markdown report to evaluation/results/ANALYSIS.md:
 *
 *   1. Aggregate statistics  — pass rate / mean score per dimension × mode, with
 *      per-scenario means and std-devs across repeats aggregated up to the dimension.
 *   2. System vs baseline    — per-dimension pass-rate gap with an approximate 95% CI.
 *   3. Per-tag / per-NPC      — pass rates broken out by scenario tag and by NPC × mode.
 *   4. Failure cases          — every (scenario, mode) that failed in ≥3 repeats, with
 *      all raw responses and judge reasonings (the failure-analysis candidates).
 *   5. Expert raters          — mean rating per response, system-vs-baseline means, and
 *      pairwise inter-rater reliability (Pearson) where ≥2 raters overlap.
 *
 * Multiple result files often cover the same (scenario, mode, repeat) — debug runs,
 * re-runs, full sweeps. We DEDUPE by (scenarioId|mode|repeat) keeping the run from
 * the file with the latest finishedAt, so the analysis reflects the most recent code
 * for each cell rather than mixing pre/post-fix behavior.
 *
 *   npx tsx scripts/analyze-eval.ts        (or: npm run analyze-eval)
 */

import { readFileSync, readdirSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const RESULTS_DIR = join(ROOT, "evaluation", "results");
const SCENARIOS_DIR = join(ROOT, "evaluation", "scenarios");
const ANSWER_KEY = join(ROOT, "evaluation", "external", "answer-key.json");
const OUT = join(RESULTS_DIR, "ANALYSIS.md");

const Z = 1.96; // 95%

// ── Types ─────────────────────────────────────────────────────────────────────

interface RunRow {
  scenarioId: string;
  mode: string;
  repeat: number;
  dimension: string;
  method: string;
  npcs: string[];
  pass: boolean | null;
  score: number | null;
  reasoning: string | null;
  response: string | null;
  error: string | null;
  finishedAt: string;
  sourceFile: string;
}

interface ScenarioMeta {
  id: string;
  dimension: string;
  npcs: string[];
  tags: string[];
  method: string;
  title: string;
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function sampleStd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Wilson score 95% interval for a binomial proportion (robust near 0/1). */
function wilson(successes: number, n: number): [number, number] {
  if (n === 0) return [NaN, NaN];
  const p = successes / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** Approximate (Wald) 95% CI on the difference of two independent proportions. */
function diffCI(s1: number, n1: number, s2: number, n2: number): { diff: number; lo: number; hi: number } {
  const p1 = s1 / n1;
  const p2 = s2 / n2;
  const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  const diff = p1 - p2;
  return { diff, lo: diff - Z * se, hi: diff + Z * se };
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return NaN;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? NaN : num / den;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "–");
const pct1 = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "–");
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "–");
const sgn = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)} pp` : "–");

// ── Loaders ───────────────────────────────────────────────────────────────────

function loadScenarios(): Map<string, ScenarioMeta> {
  const m = new Map<string, ScenarioMeta>();
  if (!existsSync(SCENARIOS_DIR)) return m;
  for (const f of readdirSync(SCENARIOS_DIR).filter((x) => x.endsWith(".yaml"))) {
    try {
      const raw = yaml.load(readFileSync(join(SCENARIOS_DIR, f), "utf8")) as Record<string, unknown>;
      if (!raw || !raw.id) continue;
      const npcs = Array.isArray(raw.npcs)
        ? (raw.npcs as string[])
        : raw.npc
          ? [raw.npc as string]
          : [];
      m.set(raw.id as string, {
        id: raw.id as string,
        dimension: (raw.dimension as string) ?? "unknown",
        npcs,
        tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
        method: (raw.evaluation_method as string) ?? "unknown",
        title: (raw.title as string) ?? "",
      });
    } catch {
      /* skip malformed scenario */
    }
  }
  return m;
}

/** Load + dedupe all run rows by (scenario|mode|repeat), keeping the latest. */
function loadRuns(): { rows: RunRow[]; files: string[] } {
  if (!existsSync(RESULTS_DIR)) return { rows: [], files: [] };
  const files = readdirSync(RESULTS_DIR).filter(
    (f) =>
      f.endsWith(".json") &&
      !f.startsWith("human_ratings_") &&
      !f.startsWith("external_ratings_"),
  );
  const byKey = new Map<string, RunRow>();
  const contributing = new Set<string>();

  for (const f of files) {
    const path = join(RESULTS_DIR, f);
    let rep: { meta?: { finishedAt?: string; startedAt?: string }; runs?: unknown[] };
    try {
      rep = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(rep.runs)) continue;
    const finishedAt =
      rep.meta?.finishedAt ?? rep.meta?.startedAt ?? statSync(path).mtime.toISOString();

    for (const raw of rep.runs) {
      const r = raw as {
        scenarioId?: string;
        mode?: string;
        repeat?: number;
        dimension?: string;
        evaluationMethod?: string;
        npcs?: string[];
        evaluation?: { pass?: boolean | null; score?: number | null; reasoning?: string | null };
        captured?: { primaryResponse?: string | null; responsesByNpc?: Record<string, { reply?: string }> };
        error?: string | null;
      };
      if (!r.scenarioId || !r.mode) continue;
      const repeat = typeof r.repeat === "number" ? r.repeat : 1;
      const key = `${r.scenarioId}|${r.mode}|${repeat}`;
      const existing = byKey.get(key);
      if (existing && existing.finishedAt >= finishedAt) continue;

      const response =
        r.captured?.primaryResponse ??
        (r.captured?.responsesByNpc
          ? Object.values(r.captured.responsesByNpc)[0]?.reply ?? null
          : null);

      byKey.set(key, {
        scenarioId: r.scenarioId,
        mode: r.mode,
        repeat,
        dimension: r.dimension ?? "unknown",
        method: r.evaluationMethod ?? "unknown",
        npcs: Array.isArray(r.npcs) ? r.npcs : [],
        pass: typeof r.evaluation?.pass === "boolean" ? r.evaluation.pass : null,
        score: typeof r.evaluation?.score === "number" ? r.evaluation.score : null,
        reasoning: r.evaluation?.reasoning ?? null,
        response,
        error: r.error ?? null,
        finishedAt,
        sourceFile: f,
      });
      contributing.add(f);
    }
  }
  return { rows: Array.from(byKey.values()), files: Array.from(contributing).sort() };
}

// ── Rater loading (CLI human_ratings_* + web external_ratings_* via answer key) ─

interface RatingRecord {
  rater: string;
  responseId: string; // the specific response rated (pool id, or scenario|mode for the CLI)
  label: string; // human label for the response
  scenarioId: string;
  mode: string;
  metric: "holistic" | "authentic" | "voice";
  value: number;
}

function loadRatings(): RatingRecord[] {
  const out: RatingRecord[] = [];
  if (!existsSync(RESULTS_DIR)) return out;

  // CLI blind ratings (one holistic 1–5 per response, mode already attached).
  for (const f of readdirSync(RESULTS_DIR).filter((x) => x.startsWith("human_ratings_") && x.endsWith(".json"))) {
    try {
      const j = JSON.parse(readFileSync(join(RESULTS_DIR, f), "utf8")) as {
        rater?: string;
        ratings?: Array<{ scenarioId?: string; mode?: string; rating?: number }>;
      };
      const rater = j.rater ?? f.replace(/^human_ratings_|\.json$/g, "");
      for (const r of j.ratings ?? []) {
        if (!r.scenarioId || !r.mode || typeof r.rating !== "number") continue;
        out.push({
          rater,
          responseId: `cli|${r.scenarioId}|${r.mode}`,
          label: r.scenarioId,
          scenarioId: r.scenarioId,
          mode: r.mode,
          metric: "holistic",
          value: r.rating,
        });
      }
    } catch {
      /* skip */
    }
  }

  // Web survey ratings (authentic + voice per pool id; de-blind via answer-key).
  let key: Record<string, { mode?: string; scenarioId?: string }> = {};
  if (existsSync(ANSWER_KEY)) {
    try {
      key = (JSON.parse(readFileSync(ANSWER_KEY, "utf8")) as { key?: typeof key }).key ?? {};
    } catch {
      /* no key → can't de-blind web ratings */
    }
  }
  for (const f of readdirSync(RESULTS_DIR).filter((x) => x.startsWith("external_ratings_") && x.endsWith(".json"))) {
    try {
      const j = JSON.parse(readFileSync(join(RESULTS_DIR, f), "utf8")) as {
        rater?: string;
        submissions?: Array<{ ratings?: Array<{ id?: string; authentic?: number; voice?: number }> }>;
      };
      const rater = j.rater ?? f.replace(/^external_ratings_|\.json$/g, "");
      // Keep only the LAST submission per rater (their final answers).
      const last = j.submissions?.[j.submissions.length - 1];
      for (const r of last?.ratings ?? []) {
        const meta = r.id ? key[r.id] : undefined;
        if (!meta?.scenarioId || !meta.mode) continue;
        const sid = meta.scenarioId;
        const md = meta.mode;
        const rid = r.id as string;
        const label = `${sid} · ${rid}`;
        if (typeof r.authentic === "number")
          out.push({ rater, responseId: rid, label, scenarioId: sid, mode: md, metric: "authentic", value: r.authentic });
        if (typeof r.voice === "number")
          out.push({ rater, responseId: rid, label, scenarioId: sid, mode: md, metric: "voice", value: r.voice });
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/** Per (scenario, mode): repeats, pass rate + std, mean score + std. */
interface Cell {
  scenarioId: string;
  mode: string;
  dimension: string;
  method: string;
  n: number;
  passes: number[]; // 0/1 across repeats (only boolean-evaluated)
  scores: number[]; // 1–5 across repeats (llm_judge)
  failCount: number;
  rows: RunRow[];
}

function cells(rows: RunRow[]): Map<string, Cell> {
  const m = new Map<string, Cell>();
  for (const r of rows) {
    const k = `${r.scenarioId}|${r.mode}`;
    let c = m.get(k);
    if (!c) {
      c = {
        scenarioId: r.scenarioId,
        mode: r.mode,
        dimension: r.dimension,
        method: r.method,
        n: 0,
        passes: [],
        scores: [],
        failCount: 0,
        rows: [],
      };
      m.set(k, c);
    }
    c.n++;
    c.rows.push(r);
    if (typeof r.pass === "boolean") {
      c.passes.push(r.pass ? 1 : 0);
      if (!r.pass) c.failCount++;
    }
    if (typeof r.score === "number") c.scores.push(r.score);
  }
  return m;
}

// ── Markdown builder ──────────────────────────────────────────────────────────

const L: string[] = [];
const line = (s = "") => L.push(s);

function table(headers: string[], rows: string[][]) {
  line(`| ${headers.join(" | ")} |`);
  line(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const r of rows) line(`| ${r.join(" | ")} |`);
  line();
}

function main() {
  const scenarios = loadScenarios();
  const { rows, files } = loadRuns();
  const ratings = loadRatings();
  const cellMap = cells(rows);
  const modes = Array.from(new Set(rows.map((r) => r.mode))).sort();
  const dims = Array.from(new Set(rows.map((r) => r.dimension))).sort();
  const generatedAt = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";

  line(`# Evaluation Analysis — Stanford Society`);
  line();
  line(`_Generated ${generatedAt} by \`scripts/analyze-eval.ts\`._`);
  line();
  line(
    `Built from **${rows.length} deduped runs** across **${files.length} result file(s)**, ` +
      `**${scenarios.size} scenarios**, modes: ${modes.map((m) => `\`${m}\``).join(", ") || "none"}. ` +
      `Runs are deduped by (scenario, mode, repeat), keeping the most recent — so each cell reflects ` +
      `the latest run rather than a mix of pre/post-fix debug runs.`,
  );
  line();
  line(`> **Read the n.** Most cells have few repeats; confidence intervals are wide and many `);
  line(`> std-devs are 0 simply because n=1. Treat single-repeat numbers as point estimates, not `);
  line(`> significant results. Re-run with \`--repeats 5\` in both modes to tighten everything below.`);
  line();

  // ── 1. Aggregate by dimension × mode ────────────────────────────────────────
  line(`## 1. Aggregate statistics — by dimension × mode`);
  line();
  line(
    `Per scenario we average pass (0/1) and score (1–5) across its repeats, then aggregate those ` +
      `per-scenario means up to the dimension (**macro** = scenarios weighted equally). **Pooled** ` +
      `pass rate counts every evaluated run equally, with a Wilson 95% interval. \`scenarios\` = ` +
      `distinct scenarios with ≥1 evaluated run in that mode; \`runs\` = total repeats.`,
  );
  line();

  const dimModeRows: string[][] = [];
  for (const dim of dims) {
    for (const mode of modes) {
      const cs = Array.from(cellMap.values()).filter((c) => c.dimension === dim && c.mode === mode);
      if (!cs.length) continue;
      const scenarioPassRates = cs.filter((c) => c.passes.length).map((c) => mean(c.passes));
      const macro = scenarioPassRates.length ? mean(scenarioPassRates) : NaN;
      const pooledSucc = cs.reduce((a, c) => a + c.passes.filter((x) => x === 1).length, 0);
      const pooledN = cs.reduce((a, c) => a + c.passes.length, 0);
      const pooled = pooledN ? pooledSucc / pooledN : NaN;
      const [lo, hi] = pooledN ? wilson(pooledSucc, pooledN) : [NaN, NaN];
      const allScores = cs.flatMap((c) => c.scores);
      const totalRuns = cs.reduce((a, c) => a + c.n, 0);
      const humanRated = cs.filter((c) => c.method === "human_rated").length;
      dimModeRows.push([
        dim,
        `\`${mode}\``,
        String(cs.length),
        String(totalRuns),
        pooledN ? `${pct(macro)}` : humanRated ? "_human-rated_" : "–",
        pooledN ? `${pct(pooled)} (${pooledSucc}/${pooledN}) [${pct(lo)}–${pct(hi)}]` : "–",
        allScores.length ? `${f2(mean(allScores))} ± ${f2(sampleStd(allScores))}` : "–",
      ]);
    }
  }
  table(
    ["dimension", "mode", "scenarios", "runs", "macro pass", "pooled pass [95% CI]", "mean score ± sd"],
    dimModeRows,
  );

  // Overall by mode.
  const overallRows: string[][] = [];
  for (const mode of modes) {
    const cs = Array.from(cellMap.values()).filter((c) => c.mode === mode);
    const succ = cs.reduce((a, c) => a + c.passes.filter((x) => x === 1).length, 0);
    const n = cs.reduce((a, c) => a + c.passes.length, 0);
    const [lo, hi] = n ? wilson(succ, n) : [NaN, NaN];
    const allScores = cs.flatMap((c) => c.scores);
    overallRows.push([
      `\`${mode}\``,
      String(cs.reduce((a, c) => a + c.n, 0)),
      n ? `${pct(succ / n)} [${pct(lo)}–${pct(hi)}]` : "–",
      allScores.length ? f2(mean(allScores)) : "–",
    ]);
  }
  line(`**Overall by mode** (pooled across all dimensions):`);
  line();
  table(["mode", "runs", "pass rate [95% CI]", "mean score"], overallRows);

  // ── 2. System vs baseline ───────────────────────────────────────────────────
  line(`## 2. System vs. baseline`);
  line();
  if (modes.includes("system") && modes.includes("baseline")) {
    line(
      `Pooled pass-rate gap per dimension with an **approximate (Wald) 95% CI on the difference**. ` +
        `Positive = system better. With small n these intervals are wide; a CI that excludes 0 is ` +
        `suggestive, not conclusive.`,
    );
    line();
    const cmpRows: string[][] = [];
    const sentences: string[] = [];
    for (const dim of dims) {
      const sys = Array.from(cellMap.values()).filter((c) => c.dimension === dim && c.mode === "system");
      const base = Array.from(cellMap.values()).filter((c) => c.dimension === dim && c.mode === "baseline");
      const s1 = sys.reduce((a, c) => a + c.passes.filter((x) => x === 1).length, 0);
      const n1 = sys.reduce((a, c) => a + c.passes.length, 0);
      const s2 = base.reduce((a, c) => a + c.passes.filter((x) => x === 1).length, 0);
      const n2 = base.reduce((a, c) => a + c.passes.length, 0);
      if (!n1 || !n2) {
        cmpRows.push([dim, n1 ? pct(s1 / n1) : "–", n2 ? pct(s2 / n2) : "–", "–", "_one mode only_"]);
        continue;
      }
      const { diff, lo, hi } = diffCI(s1, n1, s2, n2);
      const excludes0 = lo > 0 || hi < 0;
      cmpRows.push([
        dim,
        `${pct(s1 / n1)} (n=${n1})`,
        `${pct(s2 / n2)} (n=${n2})`,
        sgn(diff),
        `[${sgn(lo)}, ${sgn(hi)}]${excludes0 ? " ✶" : ""}`,
      ]);
      sentences.push(
        `**${dim.replace(/_/g, " ")}** passed ${pct(s1 / n1)} in system vs ${pct(s2 / n2)} in baseline ` +
          `(${sgn(diff)}${excludes0 ? ", CI excludes 0" : ", CI includes 0 — not significant at this n"}).`,
      );
    }
    table(["dimension", "system pass", "baseline pass", "gap", "95% CI on gap"], cmpRows);
    line(`✶ = CI excludes zero.`);
    line();
    for (const s of sentences) line(`- ${s}`);
    line();
  } else {
    line(`_Both \`system\` and \`baseline\` runs are required for this comparison; only found: ${modes.join(", ") || "none"}._`);
    line();
  }

  // ── 3. Per-tag and per-NPC breakdown ────────────────────────────────────────
  line(`## 3. Breakdown by tag and NPC`);
  line();
  line(
    `Tags come from the scenario YAML (\`tags:\`). Each row pools every evaluated run whose scenario ` +
      `carries that tag, split by mode. NPC rows credit every NPC a scenario involves.`,
  );
  line();

  function groupPass(keyOf: (r: RunRow) => string[]): Map<string, Record<string, { s: number; n: number }>> {
    const g = new Map<string, Record<string, { s: number; n: number }>>();
    for (const r of rows) {
      if (typeof r.pass !== "boolean") continue;
      for (const k of keyOf(r)) {
        let rec = g.get(k);
        if (!rec) {
          rec = {};
          g.set(k, rec);
        }
        const cell = (rec[r.mode] ??= { s: 0, n: 0 });
        cell.n++;
        if (r.pass) cell.s++;
      }
    }
    return g;
  }

  const tagGroups = groupPass((r) => scenarios.get(r.scenarioId)?.tags ?? []);
  const tagRows: string[][] = [];
  for (const tag of Array.from(tagGroups.keys()).sort()) {
    const rec = tagGroups.get(tag)!;
    tagRows.push([
      `\`${tag}\``,
      rec.system ? `${pct(rec.system.s / rec.system.n)} (${rec.system.s}/${rec.system.n})` : "–",
      rec.baseline ? `${pct(rec.baseline.s / rec.baseline.n)} (${rec.baseline.s}/${rec.baseline.n})` : "–",
    ]);
  }
  if (tagRows.length) {
    line(`### By tag`);
    line();
    table(["tag", "system pass", "baseline pass"], tagRows);
  }

  const npcGroups = groupPass((r) => (r.npcs.length ? r.npcs : ["(none)"]));
  const npcRows: string[][] = [];
  for (const npc of Array.from(npcGroups.keys()).sort()) {
    const rec = npcGroups.get(npc)!;
    npcRows.push([
      npc,
      rec.system ? `${pct(rec.system.s / rec.system.n)} (${rec.system.s}/${rec.system.n})` : "–",
      rec.baseline ? `${pct(rec.baseline.s / rec.baseline.n)} (${rec.baseline.s}/${rec.baseline.n})` : "–",
    ]);
  }
  if (npcRows.length) {
    line(`### By NPC`);
    line();
    table(["npc", "system pass", "baseline pass"], npcRows);
  }

  // A couple of data-driven interpretive sentences for the sharpest tag contrasts.
  const contrasts: { tag: string; sys: number; base: number; gap: number }[] = [];
  for (const [tag, rec] of Array.from(tagGroups)) {
    if (rec.system?.n && rec.baseline?.n) {
      const sys = rec.system.s / rec.system.n;
      const base = rec.baseline.s / rec.baseline.n;
      contrasts.push({ tag, sys, base, gap: sys - base });
    }
  }
  contrasts.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  if (contrasts.length) {
    line(`**Sharpest tag contrasts (system − baseline):**`);
    line();
    for (const c of contrasts.slice(0, 5)) {
      line(`- \`${c.tag}\`: ${pct(c.sys)} system vs ${pct(c.base)} baseline (${sgn(c.gap)}).`);
    }
    line();
  }

  // ── 4. Failure cases (≥3 repeats failed) ────────────────────────────────────
  line(`## 4. Failure cases — candidates for failure analysis`);
  line();
  line(
    `Every (scenario, mode) that **failed in ≥3 repeats** is listed first; below that, cells with ` +
      `fewer repeats that nonetheless failed every repeat (flagged \`low-n\`). Each lists all raw ` +
      `responses and judge reasonings.`,
  );
  line();

  const failing = Array.from(cellMap.values())
    .filter((c) => c.passes.length > 0 && (c.failCount >= 3 || c.failCount === c.passes.length))
    .sort((a, b) => {
      const fa = a.failCount / a.passes.length;
      const fb = b.failCount / b.passes.length;
      return fb - fa || b.failCount - a.failCount;
    });

  if (!failing.length) {
    line(`_No (scenario, mode) failed in ≥3 repeats (or all of <3 repeats)._`);
    line();
  } else {
    for (const c of failing) {
      const lowN = c.failCount < 3;
      const sc = scenarios.get(c.scenarioId);
      line(
        `### \`${c.scenarioId}\` — \`${c.mode}\` — failed ${c.failCount}/${c.passes.length}` +
          `${lowN ? " _(low-n)_" : ""}`,
      );
      line();
      line(
        `- dimension: **${c.dimension}** · method: \`${c.method}\`` +
          (sc?.tags.length ? ` · tags: ${sc.tags.map((t) => `\`${t}\``).join(", ")}` : ""),
      );
      if (sc?.title) line(`- _${sc.title}_`);
      line();
      const sorted = [...c.rows].sort((a, b) => a.repeat - b.repeat);
      for (const r of sorted) {
        const verdict = r.pass === false ? "FAIL" : r.pass === true ? "PASS" : r.error ? "ERROR" : "—";
        line(`<details><summary>repeat ${r.repeat} — ${verdict}${r.score != null ? ` (score ${r.score})` : ""}</summary>`);
        line();
        if (r.error) line(`> error: ${r.error}`);
        line(`**Response:**`);
        line();
        line("> " + (r.response ? r.response.replace(/\n/g, "\n> ") : "_(no response captured)_"));
        line();
        if (r.reasoning) {
          line(`**Judge:** ${r.reasoning}`);
          line();
        }
        line(`</details>`);
        line();
      }
    }
  }

  // ── 5. Expert rater aggregates ──────────────────────────────────────────────
  line(`## 5. Expert rater aggregates`);
  line();
  if (!ratings.length) {
    line(`_No rater files found (\`human_ratings_*.json\` / \`external_ratings_*.json\`)._`);
    line();
  } else {
    const metrics = Array.from(new Set(ratings.map((r) => r.metric)));
    const raters = Array.from(new Set(ratings.map((r) => r.rater))).sort();
    line(
      `Sources: **${raters.length} rater(s)** (${raters.map((r) => `\`${r}\``).join(", ")}), ` +
        `metrics: ${metrics.map((m) => `\`${m}\``).join(", ")}. ` +
        `\`holistic\` = the blind CLI 1–5; \`authentic\`/\`voice\` = the /eval-rate survey scales.`,
    );
    line();

    for (const metric of metrics) {
      const recs = ratings.filter((r) => r.metric === metric);
      const metricRaters = Array.from(new Set(recs.map((r) => r.rater)));
      line(`### Metric: \`${metric}\``);
      line();
      line(`_${metricRaters.length} rater(s) contributed this metric: ${metricRaters.map((r) => `\`${r}\``).join(", ")}._`);
      line();

      // Mean per response (per pool item / response identity) across raters.
      const perResp = new Map<string, { label: string; mode: string; vals: number[] }>();
      for (const r of recs) {
        const e = perResp.get(r.responseId) ?? { label: r.label, mode: r.mode, vals: [] };
        e.vals.push(r.value);
        perResp.set(r.responseId, e);
      }
      const respRows = Array.from(perResp.values())
        .sort((a, b) => a.mode.localeCompare(b.mode) || a.label.localeCompare(b.label))
        .map((e) => [e.label, `\`${e.mode}\``, f2(mean(e.vals)), String(e.vals.length)]);
      table(["response", "mode", "mean rating", "raters"], respRows);

      // System vs baseline mean (pooled across responses + raters).
      const sysVals = recs.filter((r) => r.mode === "system").map((r) => r.value);
      const baseVals = recs.filter((r) => r.mode === "baseline").map((r) => r.value);
      if (sysVals.length && baseVals.length) {
        const ms = mean(sysVals);
        const mb = mean(baseVals);
        line(
          `- **System** mean ${f2(ms)} ± ${f2(sampleStd(sysVals))} (n=${sysVals.length}) vs ` +
            `**baseline** ${f2(mb)} ± ${f2(sampleStd(baseVals))} (n=${baseVals.length}) — ` +
            `Δ ${f2(ms - mb)} (${ms > mb ? "system higher" : ms < mb ? "baseline higher" : "tied"}).`,
        );
        line();
      }

      // Pairwise inter-rater reliability (Pearson) over commonly-rated responses.
      const irrRows: string[][] = [];
      for (let i = 0; i < metricRaters.length; i++) {
        for (let j = i + 1; j < metricRaters.length; j++) {
          const ra = metricRaters[i];
          const rb = metricRaters[j];
          const map: Record<string, { a?: number; b?: number }> = {};
          for (const r of recs) {
            if (r.rater === ra) (map[r.responseId] ??= {}).a = r.value;
            if (r.rater === rb) (map[r.responseId] ??= {}).b = r.value;
          }
          const pairs = Object.values(map).filter((p) => p.a != null && p.b != null);
          if (!pairs.length) continue; // skip non-overlapping rater pairs
          const a = pairs.map((p) => p.a as number);
          const b = pairs.map((p) => p.b as number);
          irrRows.push([`${ra} ↔ ${rb}`, String(pairs.length), pairs.length >= 3 ? f2(pearson(a, b)) : "_n<3_"]);
        }
      }
      if (irrRows.length) {
        const rs = irrRows.map((r) => Number(r[2])).filter((x) => Number.isFinite(x));
        line(
          `**Inter-rater reliability** (pairwise Pearson on commonly-rated responses)` +
            `${rs.length ? ` — mean r = **${f2(mean(rs))}** across ${rs.length} pair(s)` : ""}:`,
        );
        line();
        table(["rater pair", "common", "Pearson r"], irrRows);
        line(`> Pearson needs ≥3 overlapping responses to be meaningful; pairs with fewer are marked _n<3_.`);
        line();
      } else {
        line(
          `- **Inter-rater reliability:** no two raters rated the same response for this metric ` +
            `(need overlap). _(${metricRaters.length} rater(s) contributed.)_`,
        );
        line();
      }
    }
  }

  // ── Provenance footer ───────────────────────────────────────────────────────
  line(`## Provenance & caveats`);
  line();
  line(`- **Result files used** (${files.length}): ${files.map((f) => `\`${f}\``).join(", ") || "none"}.`);
  line(`- Runs deduped by (scenario, mode, repeat), latest \`finishedAt\` wins.`);
  line(`- \`human_rated\` scenarios have no auto pass/score; they appear only in §5 (rater aggregates).`);
  line(`- Pass-rate CIs: Wilson (single proportion) / Wald (difference). Both approximate at small n.`);
  line(`- This report is regenerated by \`npm run analyze-eval\`; it overwrites \`evaluation/results/ANALYSIS.md\`.`);
  line();

  writeFileSync(OUT, L.join("\n"));
  console.log(`Wrote ${OUT}`);
  console.log(`  ${rows.length} runs · ${scenarios.size} scenarios · ${files.length} files · ${ratings.length} rating records`);
}

main();
