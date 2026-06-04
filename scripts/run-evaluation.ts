/**
 * Evaluation runner for the Stanford Society scenario suite.
 *
 * Replays each YAML scenario in evaluation/scenarios/ against the running app
 * (chat / conversation-end / advance-day HTTP endpoints), captures what the NPC
 * said, what memories it retrieved, and what relationship deltas were applied,
 * then scores it with the scenario's `evaluation_method`. Aggregates by
 * dimension and writes a structured JSON report.
 *
 * USAGE (the app must be running — `npm run dev`):
 *   npm run eval -- --all --mode system
 *   npm run eval -- --all --mode baseline --repeats 3
 *   npm run eval -- --scenario mem-01-family-pressure-secret --mode system
 *   npm run eval -- --all --mode system --output evaluation/results/run.json
 *   npm run eval -- --all --list          # list selected scenarios and exit (no network)
 *
 * FLAGS:
 *   --mode <system|baseline>   required (unless --list). system = full stateful
 *                              path; baseline = stateless-NPC ablation (sends the
 *                              X-Eval-Mode header to /api/chat).
 *   --scenario <id>            run a single scenario by id
 *   --all                      run every scenario
 *   --repeats <n>              repeat each scenario n times for variance (default 1)
 *   --output <path>            report path (default evaluation/results/<timestamp>.json)
 *   --base-url <url>           app base url (default $EVAL_BASE_URL or http://localhost:3000)
 *   --settle <ms>             pause after writes to let fire-and-forget memory /
 *                              consolidation land (default $EVAL_SETTLE_MS or 2000)
 *   --list                     print the selected scenarios and exit
 *
 * Each scenario runs against a DEDICATED eval player (separate UUID) so real test
 * data isn't polluted. Note: reset-game performs some GLOBAL wipes (memory_stream,
 * inter_npc_events processed-flag, npc_npc_relationships) because that state is
 * global in this single-player build — so an eval run also resets the shared NPC
 * world. That's intentional: every scenario needs a clean, known world.
 *
 * Robust to per-scenario failure: one scenario throwing is logged and recorded as
 * an errored run; the suite continues.
 */

import { config } from "dotenv";
import { resolve, join } from "node:path";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import yaml from "js-yaml";
import { inGameTimestampForDay } from "../lib/gameTime";

config({ path: resolve(process.cwd(), ".env.local") });

// ── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = process.cwd();
const SCENARIOS_DIR = join(PROJECT_ROOT, "evaluation", "scenarios");
const RESULTS_DIR = join(PROJECT_ROOT, "evaluation", "results");
const TSX_BIN = join(PROJECT_ROOT, "node_modules", ".bin", "tsx");

// A dedicated eval player, distinct from DEV_PLAYER_ID (…0001), so eval runs
// keep their own conversations / relationships separate from manual testing.
const EVAL_PLAYER_ID = "f0000000-0000-0000-0000-000000000001";
const EVAL_PLAYER_NAME = "Eval Player";

const JUDGE_MODEL = "claude-sonnet-4-6";
const DEFAULT_BASE_URL = process.env.EVAL_BASE_URL || "http://localhost:3000";
const DEFAULT_SETTLE_MS = Number(process.env.EVAL_SETTLE_MS) || 2000;

// A delta within ±this is "neutral" (matches the scenarios' calibration band).
const NEUTRAL_BAND = 0.02;
const RELEASE_POLL_TIMEOUT_MS = 30_000;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// Anthropic is only needed for llm_judge; instantiate lazily-safe (may be null).
const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

// ── Types ───────────────────────────────────────────────────────────────────

type Mode = "system" | "baseline";
type EvalMethod =
  | "keyword_match"
  | "llm_judge"
  | "human_rated"
  | "relationship_delta_direction";

type SetupStep =
  | { player: string; to?: string }
  | { end_conversation: boolean | string }
  | { advance_days: number };

interface Probe {
  to?: string | string[];
  query: string;
}

interface Scenario {
  id: string;
  dimension: string;
  npc?: string;
  npcs?: string[];
  evaluation_method: EvalMethod;
  keywords?: string[];
  keyword_match_mode?: "any" | "all";
  forbidden_keywords?: string[];
  expected_delta_directions?: Record<string, string>;
  delta_target?: "player_npc" | "npc_npc";
  judge_rubric?: string;
  judge_labels?: string[];
  rating_dimensions?: string[];
  rater_instructions?: string;
  pass_threshold?: string;
  expected_behavior?: string;
  seeded_events?: string[];
  setup?: SetupStep[];
  probe?: Probe;
  _file: string;
}

interface Scores {
  trust: number;
  respect: number;
  vibe: number;
}

interface ChatResponse {
  reply: string;
  memoriesUsed: Array<{ content: string; importance: number }>;
  relationshipScores: Scores;
  inGameDay: number;
  baselineMode: boolean;
}

interface Evaluation {
  method: EvalMethod;
  pass: boolean | null; // null = human_rated (not auto-evaluated)
  score: number | null; // 1–5 for llm_judge
  label: string | null;
  reasoning: string | null;
  details: Record<string, unknown>;
}

interface RunResult {
  scenarioId: string;
  dimension: string;
  mode: Mode;
  repeat: number;
  npcs: string[];
  evaluationMethod: EvalMethod;
  probe: Probe | null;
  captured: {
    responsesByNpc: Record<string, { reply: string; memoriesUsed: unknown[]; relationshipScores: Scores; baselineMode: boolean }>;
    primaryResponse: string | null;
    memoriesUsed: unknown[];
    deltas: Scores | null;
    deltaTarget: "player_npc" | "npc_npc" | null;
    judgeReasoning: string | null;
    npcNpcFinal: Scores | null;
  };
  evaluation: Evaluation;
  error: string | null;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const variance = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
};
const round = (x: number, n = 4) => Number(x.toFixed(n));
const sortPair = (npcs: string[]): [string, string] => {
  const [a, b] = [...npcs].sort();
  return [a, b];
};

// ── CLI parsing ───────────────────────────────────────────────────────────────

interface Args {
  mode: Mode | null;
  scenario: string | null;
  all: boolean;
  repeats: number;
  output: string | null;
  baseUrl: string;
  settleMs: number;
  list: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const has = (flag: string) => argv.includes(flag);

  if (has("--help") || has("-h")) {
    printUsage();
    process.exit(0);
  }

  const modeRaw = get("--mode");
  if (modeRaw && modeRaw !== "system" && modeRaw !== "baseline") {
    console.error(`--mode must be "system" or "baseline" (got "${modeRaw}")`);
    process.exit(1);
  }
  const repeatsRaw = get("--repeats");
  const repeats = repeatsRaw ? parseInt(repeatsRaw, 10) : 1;
  if (!Number.isInteger(repeats) || repeats < 1) {
    console.error("--repeats must be a positive integer");
    process.exit(1);
  }
  const settleRaw = get("--settle");

  return {
    mode: (modeRaw as Mode) ?? null,
    scenario: get("--scenario") ?? null,
    all: has("--all"),
    repeats,
    output: get("--output") ?? null,
    baseUrl: get("--base-url") ?? DEFAULT_BASE_URL,
    settleMs: settleRaw ? Number(settleRaw) : DEFAULT_SETTLE_MS,
    list: has("--list"),
  };
}

function printUsage() {
  console.log(
    [
      "Stanford Society evaluation runner",
      "",
      "Usage: npm run eval -- --mode <system|baseline> [--all | --scenario <id>] [options]",
      "",
      "  --mode <system|baseline>  required (system = full path, baseline = stateless ablation)",
      "  --all                     run every scenario",
      "  --scenario <id>           run one scenario",
      "  --repeats <n>             repeat each scenario n times (default 1)",
      "  --output <path>           report path (default evaluation/results/<timestamp>.json)",
      "  --base-url <url>          app url (default http://localhost:3000)",
      "  --settle <ms>             post-write settle delay (default 2000)",
      "  --list                    print selected scenarios and exit (no network)",
    ].join("\n"),
  );
}

// ── Scenario loading ──────────────────────────────────────────────────────────

function loadScenarios(): Scenario[] {
  const files = readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith(".yaml"));
  const scenarios: Scenario[] = [];
  for (const f of files) {
    const raw = yaml.load(readFileSync(join(SCENARIOS_DIR, f), "utf8")) as Scenario;
    if (!raw || !raw.id) continue;
    raw._file = f;
    scenarios.push(raw);
  }
  return scenarios.sort((a, b) => a.id.localeCompare(b.id));
}

function scenarioNpcs(sc: Scenario): string[] {
  if (sc.npcs && sc.npcs.length) return sc.npcs;
  if (sc.npc) return [sc.npc];
  return [];
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 120_000,
): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
      }
    }
    if (!res.ok) {
      throw new Error(`${url} -> ${res.status}: ${(json.error as string) ?? text.slice(0, 200)}`);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

function modeHeader(mode: Mode): Record<string, string> {
  // system -> "full" forces the normal path even if BASELINE_MODE env is set.
  return { "X-Eval-Mode": mode === "baseline" ? "baseline" : "full" };
}

async function chatTurn(
  baseUrl: string,
  mode: Mode,
  npcId: string,
  conversationId: string,
  message: string,
): Promise<ChatResponse> {
  const j = await fetchJson(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...modeHeader(mode) },
    body: JSON.stringify({ npc_id: npcId, conversation_id: conversationId, message }),
  });
  return {
    reply: (j.reply as string) ?? (j.response as string) ?? "",
    memoriesUsed: (j.memoriesUsed as ChatResponse["memoriesUsed"]) ?? [],
    relationshipScores: (j.relationshipScores as Scores) ?? { trust: 0.5, respect: 0.5, vibe: 0.5 },
    inGameDay: (j.inGameDay as number) ?? 1,
    baselineMode: Boolean(j.baselineMode),
  };
}

async function endConversationApi(
  baseUrl: string,
  conversationId: string,
): Promise<{ deltas: Scores | null; reasoning: string | null }> {
  const j = await fetchJson(`${baseUrl}/api/conversation/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId }),
  });
  const d = j.deltas as
    | { delta_trust: number; delta_respect: number; delta_vibe: number }
    | null;
  return {
    deltas: d ? { trust: d.delta_trust, respect: d.delta_respect, vibe: d.delta_vibe } : null,
    reasoning: (j.reasoning as string) ?? null,
  };
}

/** Advance one in-game day at a time up to targetDay, settling each day's
 *  fire-and-forget event release before the next advance (so concurrent
 *  releases can't race and double-apply deltas). */
async function advanceToDay(
  baseUrl: string,
  conversationId: string,
  targetDay: number,
  settleMs: number,
): Promise<number> {
  let day = await readGameDay();
  let guard = 0;
  while (day < targetDay && guard++ < 60) {
    const j = await fetchJson(`${baseUrl}/api/advance-day`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId }),
    });
    day = (j.in_game_day as number) ?? day + 1;
    await waitForRelease(day);
  }
  // Let end-of-day consolidation (also fire-and-forget) land.
  await sleep(settleMs);
  return day;
}

/** Poll until all inter-NPC events due by `day` are processed (released). */
async function waitForRelease(day: number): Promise<void> {
  const dueBy = inGameTimestampForDay(day);
  const deadline = Date.now() + RELEASE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { count, error } = await supabase
      .from("inter_npc_events")
      .select("*", { count: "exact", head: true })
      .eq("processed", false)
      .lte("in_game_timestamp", dueBy);
    if (error) return; // best-effort; don't block the run on a read hiccup
    if ((count ?? 0) === 0) return;
    await sleep(800);
  }
}

// ── DB helpers (direct service-role reads/writes) ─────────────────────────────

async function ensureEvalPlayer(): Promise<void> {
  const { error } = await supabase
    .from("players")
    .upsert({ id: EVAL_PLAYER_ID, display_name: EVAL_PLAYER_NAME }, { onConflict: "id" });
  if (error) throw new Error(`Failed to ensure eval player: ${error.message}`);
}

async function createConversation(npcId: string): Promise<string> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({ player_id: EVAL_PLAYER_ID, npc_id: npcId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to create conversation: ${error?.message}`);
  return data.id as string;
}

async function readGameDay(): Promise<number> {
  const { data } = await supabase
    .from("game_state")
    .select("in_game_day")
    .eq("player_id", EVAL_PLAYER_ID)
    .maybeSingle();
  return (data?.in_game_day as number) ?? 1;
}

async function readPairScores(a: string, b: string): Promise<Scores | null> {
  const [aId, bId] = sortPair([a, b]);
  const { data } = await supabase
    .from("npc_npc_relationships")
    .select("trust, respect, vibe")
    .eq("npc_a_id", aId)
    .eq("npc_b_id", bId)
    .maybeSingle();
  if (!data) return null;
  return { trust: data.trust as number, respect: data.respect as number, vibe: data.vibe as number };
}

function resetEvalPlayer(): void {
  const useLocal = existsSync(TSX_BIN);
  const cmd = useLocal ? TSX_BIN : "npx";
  const args = useLocal
    ? ["scripts/reset-game.ts", "--player-id", EVAL_PLAYER_ID]
    : ["tsx", "scripts/reset-game.ts", "--player-id", EVAL_PLAYER_ID];
  try {
    execFileSync(cmd, args, { cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    throw new Error(`reset-game failed: ${err.stderr?.toString().trim() || err.message}`);
  }
}

// ── Probe routing ─────────────────────────────────────────────────────────────

function probeTargets(sc: Scenario): string[] {
  const to = sc.probe?.to;
  if (Array.isArray(to)) return to;
  if (typeof to === "string") return [to];
  const fallback = sc.npc ?? sc.npcs?.[0];
  return fallback ? [fallback] : [];
}

/** Whether the probe is a chat message to an NPC (vs. a delta/state-inspection
 *  probe that the runner evaluates from captured state instead). */
function isChatProbe(sc: Scenario): boolean {
  if (sc.evaluation_method === "relationship_delta_direction") return false;
  const q = (sc.probe?.query ?? "").trim();
  if (!q || q.startsWith("(")) return false; // placeholder probe
  if (/^(inspect|compare)\b/i.test(q)) return false; // state-inspection probe
  return true;
}

// ── Scenario execution ────────────────────────────────────────────────────────

async function runScenario(
  sc: Scenario,
  mode: Mode,
  repeat: number,
  baseUrl: string,
  settleMs: number,
): Promise<RunResult> {
  const npcs = scenarioNpcs(sc);
  const base: RunResult = {
    scenarioId: sc.id,
    dimension: sc.dimension,
    mode,
    repeat,
    npcs,
    evaluationMethod: sc.evaluation_method,
    probe: sc.probe ?? null,
    captured: {
      responsesByNpc: {},
      primaryResponse: null,
      memoriesUsed: [],
      deltas: null,
      deltaTarget: null,
      judgeReasoning: null,
      npcNpcFinal: null,
    },
    evaluation: { method: sc.evaluation_method, pass: null, score: null, label: null, reasoning: null, details: {} },
    error: null,
  };

  // 1. Clean, known baseline for this scenario.
  resetEvalPlayer();

  // 2. Snapshot npc↔npc baseline (priors) if we'll measure pair drift.
  const isNpcNpc =
    sc.evaluation_method === "relationship_delta_direction" && sc.delta_target === "npc_npc";
  let npcNpcBaseline: Scores | null = null;
  if (isNpcNpc && npcs.length >= 2) npcNpcBaseline = await readPairScores(npcs[0], npcs[1]);

  // 3. A scratch conversation so advance-day can find the eval player.
  const primaryNpc = sc.npc ?? npcs[0];
  const advanceConvId = await createConversation(primaryNpc);

  // Active (un-ended) setup conversations per NPC, and any judged deltas.
  const activeConv = new Map<string, string>();
  const endDeltas = new Map<string, { deltas: Scores | null; reasoning: string | null }>();

  // 4. Replay setup steps.
  for (const step of sc.setup ?? []) {
    if ("player" in step) {
      const target = step.to ?? primaryNpc;
      let cid = activeConv.get(target);
      if (!cid) {
        cid = await createConversation(target);
        activeConv.set(target, cid);
      }
      await chatTurn(baseUrl, mode, target, cid, step.player);
      await sleep(settleMs); // let the fire-and-forget memory write land
    } else if ("end_conversation" in step) {
      const which = step.end_conversation;
      const target = typeof which === "string" ? which : primaryNpc;
      const cid = activeConv.get(target);
      if (cid) {
        const res = await endConversationApi(baseUrl, cid);
        endDeltas.set(target, res);
        activeConv.delete(target);
      }
    } else if ("advance_days" in step) {
      await advanceToDay(baseUrl, advanceConvId, step.advance_days, settleMs);
    }
  }

  // 5. Capture relationship deltas.
  if (isNpcNpc && npcs.length >= 2) {
    const final = await readPairScores(npcs[0], npcs[1]);
    base.captured.npcNpcFinal = final;
    if (final && npcNpcBaseline) {
      base.captured.deltas = {
        trust: round(final.trust - npcNpcBaseline.trust),
        respect: round(final.respect - npcNpcBaseline.respect),
        vibe: round(final.vibe - npcNpcBaseline.vibe),
      };
      base.captured.deltaTarget = "npc_npc";
    }
  } else {
    const d = endDeltas.get(primaryNpc) ?? Array.from(endDeltas.values())[0];
    if (d) {
      base.captured.deltas = d.deltas;
      base.captured.judgeReasoning = d.reasoning;
      base.captured.deltaTarget = "player_npc";
    }
  }

  // 6. Probe.
  if (isChatProbe(sc) && sc.probe) {
    for (const t of probeTargets(sc)) {
      // Continue an active setup conversation if one exists for this NPC;
      // otherwise a FRESH conversation — so memory scenarios actually exercise
      // cross-session retrieval rather than in-session context.
      let cid = activeConv.get(t);
      if (!cid) cid = await createConversation(t);
      const r = await chatTurn(baseUrl, mode, t, cid, sc.probe.query);
      base.captured.responsesByNpc[t] = {
        reply: r.reply,
        memoriesUsed: r.memoriesUsed,
        relationshipScores: r.relationshipScores,
        baselineMode: r.baselineMode,
      };
    }
    const first = probeTargets(sc)[0];
    base.captured.primaryResponse = base.captured.responsesByNpc[first]?.reply ?? null;
    base.captured.memoriesUsed = base.captured.responsesByNpc[first]?.memoriesUsed ?? [];
  }

  // For llm_judge on NPC↔NPC scenarios, the final pair state is useful context.
  if (sc.evaluation_method === "llm_judge" && npcs.length >= 2 && !base.captured.npcNpcFinal) {
    base.captured.npcNpcFinal = await readPairScores(npcs[0], npcs[1]);
  }

  // 7. Evaluate.
  base.evaluation = await evaluate(sc, base);
  return base;
}

// ── Evaluation methods ────────────────────────────────────────────────────────

async function evaluate(sc: Scenario, run: RunResult): Promise<Evaluation> {
  switch (sc.evaluation_method) {
    case "keyword_match":
      return keywordMatch(sc, run.captured.primaryResponse);
    case "relationship_delta_direction":
      return deltaDirection(sc, run.captured.deltas);
    case "human_rated":
      return {
        method: "human_rated",
        pass: null,
        score: null,
        label: "needs_human_review",
        reasoning: "human_rated — flagged for manual review; see captured response.",
        details: { rating_dimensions: sc.rating_dimensions ?? [], rater_instructions: sc.rater_instructions ?? null },
      };
    case "llm_judge":
      return llmJudge(sc, run);
    default:
      return { method: sc.evaluation_method, pass: null, score: null, label: null, reasoning: "unknown method", details: {} };
  }
}

function keywordMatch(sc: Scenario, response: string | null): Evaluation {
  const text = (response ?? "").toLowerCase();
  const keywords = (sc.keywords ?? []).map(String);
  const forbidden = (sc.forbidden_keywords ?? []).map(String);
  const matched = keywords.filter((k) => text.includes(k.toLowerCase()));
  const hitForbidden = forbidden.filter((k) => text.includes(k.toLowerCase()));
  const matchMode = sc.keyword_match_mode ?? "any";
  let pass = matchMode === "all" ? matched.length === keywords.length && keywords.length > 0 : matched.length > 0;
  if (hitForbidden.length) pass = false;
  if (response == null) pass = false;
  return {
    method: "keyword_match",
    pass,
    score: null,
    label: null,
    reasoning: response == null ? "no response captured" : `matched ${matched.length}/${keywords.length} (${matchMode})`,
    details: { matched, forbidden: hitForbidden, matchMode, totalKeywords: keywords.length },
  };
}

type Dir = "up" | "down" | "neutral" | "up_or_neutral" | "down_or_neutral";
function classify(delta: number): "up" | "down" | "neutral" {
  if (delta > NEUTRAL_BAND) return "up";
  if (delta < -NEUTRAL_BAND) return "down";
  return "neutral";
}
function directionOk(expected: Dir, cls: "up" | "down" | "neutral"): boolean {
  switch (expected) {
    case "up":
      return cls === "up";
    case "down":
      return cls === "down";
    case "neutral":
      return cls === "neutral";
    case "up_or_neutral":
      return cls !== "down";
    case "down_or_neutral":
      return cls !== "up";
    default:
      return false;
  }
}

function deltaDirection(sc: Scenario, deltas: Scores | null): Evaluation {
  if (!deltas) {
    return {
      method: "relationship_delta_direction",
      pass: false,
      score: null,
      label: null,
      reasoning: "no deltas captured (the conversation may not have been judged, or no pair drift)",
      details: { deltaTarget: sc.delta_target ?? "player_npc" },
    };
  }
  const expected = (sc.expected_delta_directions ?? {}) as Record<string, Dir>;
  const perDim: Record<string, unknown> = {};
  let pass = true;
  for (const dim of ["trust", "respect", "vibe"] as const) {
    if (!(dim in expected)) continue;
    const d = deltas[dim] ?? 0;
    const cls = classify(d);
    const ok = directionOk(expected[dim], cls);
    perDim[dim] = { expected: expected[dim], delta: round(d), classified: cls, pass: ok };
    pass = pass && ok;
  }
  return {
    method: "relationship_delta_direction",
    pass,
    score: null,
    label: null,
    reasoning: Object.entries(perDim)
      .map(([k, v]) => `${k}: ${(v as { delta: number }).delta} (${(v as { classified: string }).classified}, want ${(v as { expected: string }).expected})`)
      .join("; "),
    details: { deltaTarget: sc.delta_target ?? "player_npc", perDim },
  };
}

const JUDGE_SYSTEM =
  "You are a strict, impartial evaluator for a Stanford social-simulation game. " +
  "Given a test scenario's expected behavior and rubric, plus what the NPC actually " +
  "produced, decide whether it meets the bar. Be specific and do not be generous: a " +
  "fluent but wrong answer fails. Score 1 (clearly fails) to 5 (fully meets the " +
  "expected behavior). Record your verdict via the record_judgment tool.";

async function llmJudge(sc: Scenario, run: RunResult): Promise<Evaluation> {
  if (!anthropic) {
    return { method: "llm_judge", pass: null, score: null, label: null, reasoning: "ANTHROPIC_API_KEY not set — judge skipped", details: {} };
  }
  const parts: string[] = [];
  parts.push(`SCENARIO: ${sc.id}  (dimension: ${sc.dimension})`);
  if (sc.expected_behavior) parts.push(`EXPECTED BEHAVIOR:\n${sc.expected_behavior}`);
  if (sc.judge_rubric) parts.push(`RUBRIC:\n${sc.judge_rubric}`);
  if (sc.pass_threshold) parts.push(`PASS THRESHOLD: ${sc.pass_threshold}`);
  parts.push(`PROBE QUERY: ${sc.probe?.query ?? "(none)"}`);

  const responses = run.captured.responsesByNpc;
  if (Object.keys(responses).length) {
    for (const [npc, r] of Object.entries(responses)) parts.push(`NPC RESPONSE — ${npc}:\n${r.reply}`);
  } else {
    parts.push("(No direct chat response — evaluate from the scenario context, seeded events, and state below.)");
  }
  const mems = run.captured.memoriesUsed as Array<{ content?: string }>;
  if (mems?.length) parts.push(`MEMORIES THE NPC RETRIEVED:\n${mems.map((m) => `- ${m.content ?? ""}`).join("\n")}`);
  if (sc.seeded_events?.length) parts.push(`SEEDED OFF-SCREEN EVENTS (ground truth):\n${sc.seeded_events.map((e) => `- ${e}`).join("\n")}`);
  if (run.captured.npcNpcFinal) {
    const f = run.captured.npcNpcFinal;
    parts.push(`FINAL NPC↔NPC SCORES: trust ${round(f.trust, 3)}, respect ${round(f.respect, 3)}, vibe ${round(f.vibe, 3)}`);
  }

  const labelProp = sc.judge_labels?.length
    ? { label: { type: "string", enum: sc.judge_labels, description: "The scenario-specific verdict label." } }
    : {};
  const tool: Anthropic.Tool = {
    name: "record_judgment",
    description: "Record your evaluation of the NPC's response against the scenario.",
    input_schema: {
      type: "object",
      properties: {
        score: { type: "integer", description: "1 (clearly fails) to 5 (fully meets the expected behavior)." },
        pass: { type: "boolean", description: "Whether it meets the pass threshold for this scenario." },
        ...labelProp,
        reasoning: { type: "string", description: "1–3 sentences justifying the verdict, citing specifics." },
      },
      required: ["score", "pass", "reasoning"],
    },
  };

  try {
    const msg = await anthropic.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 500,
      system: JUDGE_SYSTEM,
      tools: [tool],
      tool_choice: { type: "tool", name: "record_judgment" },
      messages: [{ role: "user", content: parts.join("\n\n") }],
    });
    const tu = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "record_judgment",
    );
    if (!tu) return { method: "llm_judge", pass: null, score: null, label: null, reasoning: "judge did not return a verdict", details: {} };
    const input = tu.input as { score?: unknown; pass?: unknown; label?: unknown; reasoning?: unknown };
    const rawScore = Number(input.score);
    const score = Number.isFinite(rawScore) ? Math.min(5, Math.max(1, Math.round(rawScore))) : null;
    return {
      method: "llm_judge",
      pass: typeof input.pass === "boolean" ? input.pass : null,
      score,
      label: typeof input.label === "string" ? input.label : null,
      reasoning: typeof input.reasoning === "string" ? input.reasoning : null,
      details: {},
    };
  } catch (err) {
    return { method: "llm_judge", pass: null, score: null, label: null, reasoning: `judge error: ${err instanceof Error ? err.message : String(err)}`, details: {} };
  }
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function computeAggregate(runs: RunResult[], scenarios: Scenario[]) {
  const byScenario: Record<string, unknown> = {};
  for (const sc of scenarios) {
    const rs = runs.filter((r) => r.scenarioId === sc.id);
    if (!rs.length) continue;
    const passes = rs.map((r) => r.evaluation.pass).filter((p): p is boolean => typeof p === "boolean");
    const scores = rs.map((r) => r.evaluation.score).filter((s): s is number => typeof s === "number");
    byScenario[sc.id] = {
      dimension: sc.dimension,
      method: sc.evaluation_method,
      repeats: rs.length,
      passEvaluated: passes.length,
      passRate: passes.length ? round(mean(passes.map(Number)), 3) : null,
      passVariance: passes.length ? round(variance(passes.map(Number)), 4) : null,
      meanScore: scores.length ? round(mean(scores), 3) : null,
      scoreVariance: scores.length ? round(variance(scores), 4) : null,
      humanReview: rs.filter((r) => r.evaluationMethod === "human_rated").length,
      errors: rs.filter((r) => r.error).length,
    };
  }

  const dims = Array.from(new Set(scenarios.map((s) => s.dimension))).sort();
  const byDimension: Record<string, unknown> = {};
  for (const dim of dims) {
    const rs = runs.filter((r) => r.dimension === dim);
    const passes = rs.map((r) => r.evaluation.pass).filter((p): p is boolean => typeof p === "boolean");
    const scores = rs.map((r) => r.evaluation.score).filter((s): s is number => typeof s === "number");
    byDimension[dim] = {
      runs: rs.length,
      passEvaluated: passes.length,
      passRate: passes.length ? round(mean(passes.map(Number)), 3) : null,
      meanScore: scores.length ? round(mean(scores), 3) : null,
      humanReview: rs.filter((r) => r.evaluationMethod === "human_rated").length,
      errors: rs.filter((r) => r.error).length,
    };
  }

  const allPasses = runs.map((r) => r.evaluation.pass).filter((p): p is boolean => typeof p === "boolean");
  const allScores = runs.map((r) => r.evaluation.score).filter((s): s is number => typeof s === "number");
  const overall = {
    runs: runs.length,
    passEvaluated: allPasses.length,
    passRate: allPasses.length ? round(mean(allPasses.map(Number)), 3) : null,
    meanScore: allScores.length ? round(mean(allScores), 3) : null,
    humanReview: runs.filter((r) => r.evaluationMethod === "human_rated").length,
    errors: runs.filter((r) => r.error).length,
  };

  return { byDimension, byScenario, overall };
}

// ── Reporting ─────────────────────────────────────────────────────────────────

function pct(x: number | null): string {
  return x == null ? "  –  " : `${(x * 100).toFixed(0)}%`.padStart(5);
}

function printSummary(report: ReturnType<typeof buildReport>) {
  const { meta, aggregate } = report;
  console.log("\n" + "=".repeat(72));
  console.log(`  Stanford Society — Evaluation Summary`);
  console.log("=".repeat(72));
  console.log(
    `  mode=${meta.mode}  repeats=${meta.repeats}  scenarios=${meta.scenarioCount}  runs=${meta.totalRuns}  ${Math.round(meta.durationMs / 1000)}s`,
  );
  console.log("");
  console.log(`  ${"dimension".padEnd(24)} ${"runs".padStart(4)} ${"pass".padStart(6)} ${"score".padStart(6)}  human  err`);
  console.log(`  ${"-".repeat(24)} ${"-".repeat(4)} ${"-".repeat(6)} ${"-".repeat(6)}  -----  ---`);
  for (const [dim, sRaw] of Object.entries(aggregate.byDimension)) {
    const s = sRaw as { runs: number; passRate: number | null; meanScore: number | null; humanReview: number; errors: number };
    console.log(
      `  ${dim.padEnd(24)} ${String(s.runs).padStart(4)} ${pct(s.passRate)}  ${(s.meanScore == null ? "  –  " : s.meanScore.toFixed(2)).padStart(5)}  ${String(s.humanReview).padStart(5)}  ${String(s.errors).padStart(3)}`,
    );
  }
  const o = aggregate.overall;
  console.log(`  ${"-".repeat(24)}`);
  console.log(
    `  ${"OVERALL".padEnd(24)} ${String(o.runs).padStart(4)} ${pct(o.passRate)}  ${(o.meanScore == null ? "  –  " : o.meanScore.toFixed(2)).padStart(5)}  ${String(o.humanReview).padStart(5)}  ${String(o.errors).padStart(3)}`,
  );
  if (o.humanReview) console.log(`\n  ⚑ ${o.humanReview} run(s) flagged for human review (human_rated).`);
  if (o.errors) console.log(`  ✗ ${o.errors} run(s) errored — see "error" fields in the report.`);
  console.log(`\n  Report: ${meta.outputPath}`);
  console.log("=".repeat(72) + "\n");
}

function buildReport(opts: {
  mode: Mode;
  repeats: number;
  baseUrl: string;
  settleMs: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outputPath: string;
  scenarioIds: string[];
  runs: RunResult[];
  aggregate: ReturnType<typeof computeAggregate>;
}) {
  return {
    meta: {
      mode: opts.mode,
      repeats: opts.repeats,
      baseUrl: opts.baseUrl,
      settleMs: opts.settleMs,
      evalPlayerId: EVAL_PLAYER_ID,
      scenarioCount: opts.scenarioIds.length,
      totalRuns: opts.runs.length,
      scenarioIds: opts.scenarioIds,
      startedAt: opts.startedAt,
      finishedAt: opts.finishedAt,
      durationMs: opts.durationMs,
      outputPath: opts.outputPath,
    },
    aggregate: opts.aggregate,
    runs: opts.runs,
  };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const all = loadScenarios();
  const selected = args.all
    ? all
    : args.scenario
      ? all.filter((s) => s.id === args.scenario)
      : [];

  if (args.list) {
    console.log(`${selected.length || all.length} scenario(s):`);
    for (const s of (selected.length ? selected : all)) {
      console.log(`  ${s.id.padEnd(42)} ${s.dimension.padEnd(22)} ${s.evaluation_method}`);
    }
    return;
  }

  if (!args.mode) {
    console.error("--mode <system|baseline> is required. (Use --list to preview scenarios.)");
    process.exit(1);
  }
  if (!args.all && !args.scenario) {
    console.error("Specify --all or --scenario <id>.");
    process.exit(1);
  }
  if (!selected.length) {
    console.error(args.scenario ? `No scenario with id "${args.scenario}".` : "No scenarios found.");
    process.exit(1);
  }

  // Preflight: app reachable?
  try {
    await fetch(args.baseUrl, { method: "GET", signal: AbortSignal.timeout(5000) });
  } catch {
    console.error(`Cannot reach the app at ${args.baseUrl}. Start it with \`npm run dev\` (or pass --base-url).`);
    process.exit(1);
  }

  await ensureEvalPlayer();

  const startedAtMs = Date.now();
  const startedAt = new Date().toISOString();
  const outputPath = args.output ?? join(RESULTS_DIR, `${startedAt.replace(/[:.]/g, "-")}-${args.mode}.json`);

  console.log(
    `Running ${selected.length} scenario(s) × ${args.repeats} repeat(s) in "${args.mode}" mode against ${args.baseUrl}...\n`,
  );

  const runs: RunResult[] = [];
  for (let repeat = 1; repeat <= args.repeats; repeat++) {
    for (const sc of selected) {
      const tag = `[${args.mode}] ${sc.id} (${repeat}/${args.repeats})`;
      process.stdout.write(`• ${tag} ... `);
      try {
        const run = await runScenario(sc, args.mode, repeat, args.baseUrl, args.settleMs);
        runs.push(run);
        const e = run.evaluation;
        const verdict =
          e.pass === true ? "PASS" : e.pass === false ? "FAIL" : e.method === "human_rated" ? "REVIEW" : "—";
        console.log(`${verdict}${e.score != null ? ` (score ${e.score})` : ""}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`ERROR`);
        console.error(`    ↳ ${message}`);
        runs.push({
          scenarioId: sc.id,
          dimension: sc.dimension,
          mode: args.mode,
          repeat,
          npcs: scenarioNpcs(sc),
          evaluationMethod: sc.evaluation_method,
          probe: sc.probe ?? null,
          captured: { responsesByNpc: {}, primaryResponse: null, memoriesUsed: [], deltas: null, deltaTarget: null, judgeReasoning: null, npcNpcFinal: null },
          evaluation: { method: sc.evaluation_method, pass: null, score: null, label: null, reasoning: null, details: {} },
          error: message,
        });
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const aggregate = computeAggregate(runs, selected);
  const report = buildReport({
    mode: args.mode,
    repeats: args.repeats,
    baseUrl: args.baseUrl,
    settleMs: args.settleMs,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedAtMs,
    outputPath,
    scenarioIds: selected.map((s) => s.id),
    runs,
    aggregate,
  });

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  printSummary(report);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
