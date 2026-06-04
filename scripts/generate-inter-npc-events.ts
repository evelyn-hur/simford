/**
 * Generate seed inter-NPC events — the "off-screen" NPC↔NPC interactions that
 * happen in the background of the world across the 14-day in-game arc — and
 * write them to `inter_npc_events` with processed=false so lib/events.ts can
 * "release" them as the player advances days.
 *
 * Run with:
 *   npx tsx scripts/generate-inter-npc-events.ts            # generate (refuses if table non-empty)
 *   npx tsx scripts/generate-inter-npc-events.ts --reset    # wipe existing rows first, then generate
 *   npx tsx scripts/generate-inter-npc-events.ts --limit 1  # smoke test: only the first pair (cheap)
 *
 * Uses the Supabase SERVICE ROLE key directly (same rationale as the other seed
 * scripts — RLS is on with no anon insert policy). Reads ANTHROPIC_API_KEY for
 * Sonnet. NOTE: we instantiate the Anthropic client from env *after* loading
 * .env.local, rather than importing lib/anthropic — that module throws at import
 * time if the key is missing, and ESM imports evaluate before dotenv runs.
 *
 * Design choices:
 * - ONE Sonnet call PER PAIR (not per event). The events for a pair must form a
 *   coherent temporal arc (e.g. friction on day 3 → a small repair on day 9),
 *   which is only possible if the model plans all of a pair's events together.
 * - The event COUNT per pair is decided here in code from
 *   archetype_affinity_prior; the model then distributes that many events across
 *   in-game days 1–14 and writes the arc:
 *       > 0.7  high   → 4–6 events
 *     0.4–0.7  medium → 2–3 events
 *       < 0.4  low    → 0–1 events   (a 0 roll means no API call at all)
 * - Tool-use forces structured JSON. `location` is an enum in the tool schema,
 *   so every event lands at a real, fixed Stanford spot.
 * - Deltas are clamped to [-0.05, 0.05]: networks evolve through many small
 *   nudges, not big jumps.
 * - archetype_pair_key is derived in code from a fixed NPC→cluster map (the
 *   cluster scheme documented in data/npc_relationships.ts).
 *
 * relationship_deltas storage: the model returns deltas as
 * { delta_trust, delta_respect, delta_vibe } (the codebase-wide delta naming),
 * but we STORE them in the jsonb column as { trust, respect, vibe } — the shape
 * documented on the column. lib/events.ts reads {trust,respect,vibe}.
 *
 * Budget: ~51 pairs end up with ≥1 event ≈ 51 Sonnet calls. Comfortably under
 * the ~$2.50 estimate (the per-pair batching makes it cheaper than per-event).
 *
 * Idempotency: inter_npc_events has no natural key, so re-running would
 * duplicate. The script refuses to run against a non-empty table unless --reset
 * is passed (which deletes all existing rows first).
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { npcs } from "../data/npcs";
import { npcRelationships } from "../data/npc_relationships";
import { inGameTimestampForDay } from "../lib/gameTime";

// Load .env.local explicitly (dotenv defaults to .env).
config({ path: resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !serviceRoleKey || !anthropicKey) {
  console.error(
    "Missing one of NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, " +
      "ANTHROPIC_API_KEY in .env.local",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anthropic = new Anthropic({ apiKey: anthropicKey });

// Relationship reasoning matches the in-app relationship judge: Sonnet, not Haiku.
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;

// The arc spans 14 in-game days of Fall Quarter.
const TOTAL_DAYS = 14;

// Individual off-screen moments never move a relationship much.
const DELTA_LIMIT = 0.05;

// Fixed set of Stanford spots. Passed as a tool-schema enum so the model can
// only ever return one of these — `location` is always valid.
const LOCATIONS = [
  "Coupa Cafe",
  "Tresidder Union",
  "Green Library",
  "the Oval",
  "Huang Engineering Center",
  "the d.school",
  "a dorm common room",
  "GSB Patio",
  "FroSoCo lounge",
  "the CoHo",
  "Arrillaga Dining",
  "Meyer Green",
  "White Plaza",
  "Lake Lagunita",
] as const;

// NPC → social cluster. This is the cluster scheme documented in
// data/npc_relationships.ts; it's the basis for archetype_pair_key. Hardcoded
// (rather than parsed from the free-text `archetype` field) so the mapping is
// exact. Any NPC missing here throws — a loud signal to update this map.
const NPC_CLUSTER: Record<string, string> = {
  jake: "tech",
  priya: "tech",
  ben: "tech",
  eliza: "humanities",
  june: "humanities",
  marcus: "preprofessional",
  alex: "preprofessional",
  maya: "preprofessional",
  dj: "athlete",
  sasha: "athlete",
  theo: "wildcard",
  riya: "wildcard",
};

// Canonical cluster ordering, so the same cluster-pair always yields the same
// key regardless of which NPC happens to be "a" vs "b" (e.g. always
// "tech-humanities", never "humanities-tech").
const CLUSTER_RANK = [
  "tech",
  "humanities",
  "preprofessional",
  "athlete",
  "wildcard",
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function clampDelta(n: number): number {
  return clamp(Number.isFinite(n) ? n : 0, -DELTA_LIMIT, DELTA_LIMIT);
}

// Inclusive integer in [min, max].
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

type AffinityBand = "high" | "medium" | "low";

function affinityBand(prior: number): AffinityBand {
  if (prior > 0.7) return "high";
  if (prior >= 0.4) return "medium";
  return "low";
}

// How many events to generate for a pair, by affinity band.
function eventCountForBand(band: AffinityBand): number {
  switch (band) {
    case "high":
      return randInt(4, 6);
    case "medium":
      return randInt(2, 3);
    case "low":
      return randInt(0, 1);
  }
}

function archetypePairKey(aId: string, bId: string): string {
  const ca = NPC_CLUSTER[aId];
  const cb = NPC_CLUSTER[bId];
  if (!ca || !cb) {
    throw new Error(
      `No cluster mapping for NPC id '${ca ? bId : aId}' — update NPC_CLUSTER`,
    );
  }
  return [ca, cb]
    .sort((x, y) => CLUSTER_RANK.indexOf(x) - CLUSTER_RANK.indexOf(y))
    .join("-");
}

/** Shape the model returns per event (one entry in the tool's `events` array). */
interface GeneratedEvent {
  in_game_day: number;
  event_type: string;
  content: string;
  location: string;
  delta_trust: number;
  delta_respect: number;
  delta_vibe: number;
}

/** A row ready to insert into inter_npc_events. */
interface EventRow {
  npc_a_id: string;
  npc_b_id: string;
  event_type: string;
  content: string;
  location: string;
  in_game_timestamp: string;
  relationship_deltas: { trust: number; respect: number; vibe: number };
  archetype_pair_key: string;
  processed: false;
}

const SYSTEM_PROMPT = `You are a narrative designer for a Stanford social simulation. Your job is to invent plausible, specific OFF-SCREEN interactions between two students — moments that happen in the background of the game world across a 14-day stretch of Fall Quarter, while the player isn't watching.

These are small, believable campus moments: running into each other, working on something together, a quick favor, a slight, an overheard remark, a real conversation. NOT dramatic setpieces. They accumulate into how the two students feel about each other.

Guidelines:
- Make each event SPECIFIC and texture-rich. Name both students and reference who they actually are — their projects, majors, obsessions, the specific stuff in their identities and in the relationship notes you're given. Good: "Jake cornered Priya at Coupa and pitched her on joining Lexora's advisory board; she politely deflected." Bad: "Jake and Priya talked."
- Spread the events across the in-game days you're given. Don't bunch them on the same day.
- Make the SEQUENCE make sense over time. The events form an arc. If something goes wrong early, a later event can address it (a tense exchange on day 3, a small repair on day 9). Some pairs warm up, some cool off, some stay flat — let the relationship prior and their personalities decide.
- Relationship deltas are DELIBERATELY SMALL — each between -0.05 and 0.05. Networks evolve through many tiny nudges, not big jumps. A genuinely warm or sour moment is at most ±0.05; an ordinary moment is ±0.01–0.02; a purely neutral/logistical one can be 0.00. The three dimensions move INDEPENDENTLY:
    - trust: feeling safe being open with / relying on each other
    - respect: regard for the other's competence and substance
    - vibe: simple enjoyment of each other's company
  (A brilliant but condescending remark might raise respect and lower vibe.)
- Negative and neutral events are good and realistic. Do NOT default to everything being nice.

Record the events by calling the record_pair_events tool.`;

function buildTool(n: number): Anthropic.Tool {
  return {
    name: "record_pair_events",
    description:
      "Record the off-screen interactions between these two students across the in-game days.",
    input_schema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          description: `Exactly ${n} event(s), ordered by in_game_day ascending, forming a coherent arc.`,
          items: {
            type: "object",
            properties: {
              in_game_day: {
                type: "integer",
                description: `The in-game day this happened, from 1 to ${TOTAL_DAYS}.`,
              },
              event_type: {
                type: "string",
                description:
                  "Short lowercase category, e.g. collaboration, conflict, favor, smalltalk, tension, support, rivalry, reconciliation.",
              },
              content: {
                type: "string",
                description:
                  "1–3 sentences. Specific and texture-rich; name both students and reference their identities/projects.",
              },
              location: {
                type: "string",
                enum: [...LOCATIONS],
                description: "Where it happened.",
              },
              delta_trust: {
                type: "number",
                description: "Change in TRUST, a float from -0.05 to 0.05.",
              },
              delta_respect: {
                type: "number",
                description: "Change in RESPECT, a float from -0.05 to 0.05.",
              },
              delta_vibe: {
                type: "number",
                description: "Change in VIBE, a float from -0.05 to 0.05.",
              },
            },
            required: [
              "in_game_day",
              "event_type",
              "content",
              "location",
              "delta_trust",
              "delta_respect",
              "delta_vibe",
            ],
          },
        },
      },
      required: ["events"],
    },
  };
}

interface NpcLite {
  id: string;
  name: string;
  archetype: string;
  judge_summary: string;
  identity_keywords: string[];
}

interface PairPrior {
  trust: number;
  respect: number;
  vibe: number;
  archetype_affinity_prior: number;
  notes: string;
}

function buildUserContent(
  a: NpcLite,
  b: NpcLite,
  rel: PairPrior,
  n: number,
): string {
  return `TWO STUDENTS:

A) ${a.name} — ${a.archetype}
   What earns / loses their regard: ${a.judge_summary}
   Touchstones: ${a.identity_keywords.join(", ")}

B) ${b.name} — ${b.archetype}
   What earns / loses their regard: ${b.judge_summary}
   Touchstones: ${b.identity_keywords.join(", ")}

THEIR RELATIONSHIP AT THE START OF THE 14 DAYS (0–1 scale, ~0.5 is neutral):
- trust ${rel.trust.toFixed(2)}, respect ${rel.respect.toFixed(2)}, vibe ${rel.vibe.toFixed(2)}
- archetype affinity ${rel.archetype_affinity_prior.toFixed(2)} (how naturally these two types cluster)
- canon / texture: ${rel.notes}

YOUR TASK:
Invent EXACTLY ${n} interaction(s) between ${a.name} and ${b.name}, distributed across in-game days 1–${TOTAL_DAYS} (earliest first), forming a believable arc consistent with the relationship above. Then call record_pair_events.`;
}

interface PairResult {
  rows: EventRow[];
  inputTokens: number;
  outputTokens: number;
}

async function generateEventsForPair(
  a: NpcLite,
  b: NpcLite,
  rel: PairPrior,
  n: number,
): Promise<PairResult> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [buildTool(n)],
    tool_choice: { type: "tool", name: "record_pair_events" },
    messages: [{ role: "user", content: buildUserContent(a, b, rel, n) }],
  });

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "record_pair_events",
  );

  if (!toolUse) {
    throw new Error("model did not call record_pair_events");
  }

  const raw = (toolUse.input as { events?: unknown }).events;
  if (!Array.isArray(raw)) {
    throw new Error("tool input had no `events` array");
  }

  const pairKey = archetypePairKey(a.id, b.id);
  const locationSet = new Set<string>(LOCATIONS);

  const rows: EventRow[] = raw
    .map((e): EventRow | null => {
      const ev = e as Partial<GeneratedEvent>;
      const content = typeof ev.content === "string" ? ev.content.trim() : "";
      if (!content) return null; // skip empty events defensively

      const day = clamp(Math.round(Number(ev.in_game_day)), 1, TOTAL_DAYS);
      const eventType =
        typeof ev.event_type === "string" && ev.event_type.trim()
          ? ev.event_type.trim().toLowerCase()
          : "interaction";
      // enum should guarantee a valid location; fall back if a model ever drifts.
      const location =
        typeof ev.location === "string" && locationSet.has(ev.location)
          ? ev.location
          : LOCATIONS[0];

      return {
        npc_a_id: a.id,
        npc_b_id: b.id,
        event_type: eventType,
        content,
        location,
        in_game_timestamp: inGameTimestampForDay(day),
        // Stored as {trust,respect,vibe} (the column's documented shape); the
        // model emits delta_* keys, which we map here.
        relationship_deltas: {
          trust: clampDelta(Number(ev.delta_trust)),
          respect: clampDelta(Number(ev.delta_respect)),
          vibe: clampDelta(Number(ev.delta_vibe)),
        },
        archetype_pair_key: pairKey,
        processed: false,
      };
    })
    .filter((r): r is EventRow => r !== null)
    // Trust the model's arc but never exceed the budgeted count.
    .slice(0, n)
    // Defensive: ensure ascending day order even if the model didn't.
    .sort((x, y) => x.in_game_timestamp.localeCompare(y.in_game_timestamp));

  return { rows, inputTokens, outputTokens };
}

function parseLimit(): number {
  const i = process.argv.indexOf("--limit");
  if (i === -1) return Infinity;
  const v = Number(process.argv[i + 1]);
  if (!Number.isInteger(v) || v < 1) {
    console.error("--limit requires a positive integer, e.g. --limit 1");
    process.exit(1);
  }
  return v;
}

async function main() {
  const reset = process.argv.includes("--reset");
  const limit = parseLimit();

  // Build an id → NPC lookup from the seed data (the source of truth, and the
  // only place the relationship `notes` texture lives — it's not a DB column).
  const npcById = new Map<string, NpcLite>();
  for (const npc of npcs) {
    npcById.set(npc.id, {
      id: npc.id,
      name: npc.name,
      archetype: npc.archetype,
      judge_summary: npc.judge_summary,
      identity_keywords: npc.identity_keywords,
    });
  }
  console.log(`Loaded ${npcById.size} NPC(s) and ${npcRelationships.length} pair prior(s).`);

  // Idempotency guard: refuse to append to a non-empty table unless --reset.
  const { count, error: countError } = await supabase
    .from("inter_npc_events")
    .select("*", { count: "exact", head: true });
  if (countError) {
    console.error(`Failed to count inter_npc_events: ${countError.message}`);
    process.exit(1);
  }

  if ((count ?? 0) > 0) {
    if (!reset) {
      console.error(
        `inter_npc_events already has ${count} row(s). Re-running would create ` +
          `duplicates. Pass --reset to delete existing rows first, then regenerate.`,
      );
      process.exit(1);
    }
    console.log(`--reset: deleting ${count} existing row(s)...`);
    const { error: delError } = await supabase
      .from("inter_npc_events")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000"); // matches all real rows
    if (delError) {
      console.error(`Failed to delete existing rows: ${delError.message}`);
      process.exit(1);
    }
  }

  const allRows: EventRow[] = [];
  const bandTally: Record<AffinityBand, number> = { high: 0, medium: 0, low: 0 };
  let pairsWithEvents = 0;
  let pairsSkipped = 0;
  let pairsFailed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const rel of npcRelationships) {
    const a = npcById.get(rel.npc_a_id);
    const b = npcById.get(rel.npc_b_id);
    if (!a || !b) {
      console.warn(
        `  skip ${rel.npc_a_id}↔${rel.npc_b_id}: missing NPC in seed data`,
      );
      pairsSkipped++;
      continue;
    }

    const band = affinityBand(rel.archetype_affinity_prior);
    const n = eventCountForBand(band);
    if (n === 0) {
      // Low-affinity acquaintances who happened to roll 0 — no API call.
      pairsSkipped++;
      continue;
    }

    // --limit caps how many event-bearing pairs we actually call the API for.
    if (pairsWithEvents >= limit) {
      console.log(`Reached --limit ${limit}; stopping.`);
      break;
    }

    const label = `${a.id}↔${b.id}`;
    try {
      const { rows, inputTokens, outputTokens } = await generateEventsForPair(
        a,
        b,
        rel,
        n,
      );
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      allRows.push(...rows);
      bandTally[band] += rows.length;
      pairsWithEvents++;
      const days = rows
        .map((r) => new Date(r.in_game_timestamp))
        // day index back out of the timestamp purely for a readable log
        .map((d) => Math.round((d.getTime() - Date.UTC(2025, 8, 22)) / 86_400_000));
      console.log(
        `  ✓ ${label.padEnd(16)} ${band.padEnd(6)} ${rows.length} event(s)  days [${days.join(", ")}]`,
      );
    } catch (err) {
      pairsFailed++;
      console.warn(
        `  ✗ ${label}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (allRows.length === 0) {
    console.log("\nNo events generated — nothing to insert.");
    return;
  }

  console.log(`\nInserting ${allRows.length} event(s)...`);
  // Insert in chunks to stay well within request limits.
  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < allRows.length; i += CHUNK) {
    const chunk = allRows.slice(i, i + CHUNK);
    const { error: insertError } = await supabase
      .from("inter_npc_events")
      .insert(chunk);
    if (insertError) {
      console.error(
        `Insert failed at chunk starting ${i}: ${insertError.message}`,
      );
      process.exit(1);
    }
    inserted += chunk.length;
  }

  // Rough cost estimate (Sonnet ≈ $3 / Mtok in, $15 / Mtok out — verify pricing).
  const estCost =
    (totalInputTokens / 1_000_000) * 3 + (totalOutputTokens / 1_000_000) * 15;

  console.log("\n── Summary ──────────────────────────────────────────────");
  console.log(`  Pairs with events : ${pairsWithEvents}`);
  console.log(`  Pairs skipped     : ${pairsSkipped} (low-affinity rolled 0 / missing)`);
  console.log(`  Pairs failed      : ${pairsFailed}`);
  console.log(`  Events inserted   : ${inserted}`);
  console.log(`    high band       : ${bandTally.high}`);
  console.log(`    medium band     : ${bandTally.medium}`);
  console.log(`    low band        : ${bandTally.low}`);
  console.log(
    `  Tokens           : ${totalInputTokens} in / ${totalOutputTokens} out  (~$${estCost.toFixed(2)})`,
  );
  console.log("All events written with processed = false.");
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
