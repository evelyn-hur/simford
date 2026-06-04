import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { computeDerivedMetrics } from "@/lib/relationships";
import { inGameDayForTimestamp } from "@/lib/gameTime";
import { DEV_PLAYER_ID } from "@/lib/dev";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLAYER_ID = "player";
const PRIOR = 0.5; // player↔NPC relationships start neutral
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const isInternal = (id: string) => id.startsWith("__");

interface TimelineEdge {
  source: string;
  target: string;
  trust: number;
  respect: number;
  vibe: number;
  cofounder_score: number;
  close_friend_score: number;
  study_partner_score: number;
  frenemy_score: number;
  /** NPC↔NPC edge that a released system event has shifted by this day. */
  systemChanged?: boolean;
}

export interface TimelineResponse {
  currentDay: number;
  /** Player↔NPC edges as of each in-game day (1 → currentDay). */
  playerEdgesByDay: Record<string, TimelineEdge[]>;
  /** NPC↔NPC edges as of each in-game day (priors + released system deltas). */
  npcEdgesByDay: Record<string, TimelineEdge[]>;
}

interface PairDelta {
  day: number;
  t: number;
  r: number;
  v: number;
}

// Server-side memo so repeated page loads don't recompute. Invalidated when the
// day advances, new player events land, or events get released (sig changes).
let memo: { sig: string; data: TimelineResponse } | null = null;

function toTimelineEdge(
  source: string,
  target: string,
  t: number,
  r: number,
  v: number,
  systemChanged?: boolean,
): TimelineEdge {
  const dm = computeDerivedMetrics(t, r, v);
  return {
    source,
    target,
    trust: t,
    respect: r,
    vibe: v,
    cofounder_score: dm.cofounder_score,
    close_friend_score: dm.close_friend_score,
    study_partner_score: dm.study_partner_score,
    frenemy_score: dm.frenemy_score,
    ...(systemChanged ? { systemChanged: true } : {}),
  };
}

/**
 * GET /api/network/timeline — historical relationship snapshots per in-game day.
 *
 * Player↔NPC: replays relationship_events (player-scoped deltas) up to each day
 * from neutral priors. NPC↔NPC: replays RELEASED inter-NPC event deltas up to
 * each day from a derived baseline prior (= live value − all released deltas),
 * so day N reproduces the live state and earlier days show the network as it
 * was. Each NPC↔NPC edge carries `systemChanged` once a released event has
 * shifted it by that day, so the client can distinguish system-driven changes.
 */
export async function GET() {
  const supabase = createServiceRoleClient();

  const [
    { data: gs },
    { data: events, error: evErr },
    { data: npcRels, error: relErr },
    { data: interEvents, error: ieErr },
  ] = await Promise.all([
    supabase
      .from("game_state")
      .select("in_game_day")
      .eq("player_id", DEV_PLAYER_ID)
      .maybeSingle(),
    supabase
      .from("relationship_events")
      .select(
        "id, npc_id, delta_trust, delta_respect, delta_vibe, conversation_id, created_at",
      )
      .eq("player_id", DEV_PLAYER_ID)
      .order("created_at", { ascending: true }),
    supabase
      .from("npc_npc_relationships")
      .select("npc_a_id, npc_b_id, trust, respect, vibe"),
    supabase
      .from("inter_npc_events")
      .select("npc_a_id, npc_b_id, relationship_deltas, in_game_timestamp")
      .eq("processed", true),
  ]);

  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
  if (relErr) return NextResponse.json({ error: relErr.message }, { status: 500 });
  if (ieErr) return NextResponse.json({ error: ieErr.message }, { status: 500 });

  const currentDay = Math.max(1, (gs?.in_game_day as number) ?? 1);
  const evs = events ?? [];
  const rels = (npcRels ?? []).filter(
    (r) =>
      !isInternal(r.npc_a_id as string) && !isInternal(r.npc_b_id as string),
  );
  const released = interEvents ?? [];

  // Released-event count invalidates the memo when the day advances and the
  // backlog publishes (which is also when npc_npc_relationships values change).
  const sig = `${currentDay}|${evs.length}|${evs[evs.length - 1]?.id ?? ""}|${released.length}`;
  if (memo?.sig === sig) return NextResponse.json(memo.data);

  // ── Player↔NPC reconstruction ────────────────────────────────────────────
  // Map each player event to an in-game day via its conversation's messages
  // (events have no in_game_day column; the conversation's turns do).
  const convIds = Array.from(
    new Set(evs.map((e) => e.conversation_id as string | null).filter(Boolean)),
  ) as string[];
  const convDay = new Map<string, number>();
  if (convIds.length > 0) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("conversation_id, in_game_day")
      .in("conversation_id", convIds);
    for (const m of msgs ?? []) {
      const c = m.conversation_id as string;
      const d = (m.in_game_day as number | null) ?? 1;
      convDay.set(c, Math.max(convDay.get(c) ?? 0, d));
    }
  }
  const eventDay = (convId: string | null) =>
    (convId && convDay.get(convId)) || 1;

  const playerEdgesByDay: Record<string, TimelineEdge[]> = {};
  for (let d = 1; d <= currentDay; d++) {
    const stateByNpc = new Map<string, { t: number; r: number; v: number }>();
    for (const e of evs) {
      if (eventDay(e.conversation_id as string | null) > d) continue;
      const npc = e.npc_id as string;
      const s = stateByNpc.get(npc) ?? { t: PRIOR, r: PRIOR, v: PRIOR };
      s.t = clamp(s.t + ((e.delta_trust as number) ?? 0));
      s.r = clamp(s.r + ((e.delta_respect as number) ?? 0));
      s.v = clamp(s.v + ((e.delta_vibe as number) ?? 0));
      stateByNpc.set(npc, s);
    }
    playerEdgesByDay[String(d)] = Array.from(stateByNpc.entries()).map(
      ([npc, s]) => toTimelineEdge(PLAYER_ID, npc, s.t, s.r, s.v),
    );
  }

  // ── NPC↔NPC reconstruction ───────────────────────────────────────────────
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairEvents = new Map<string, PairDelta[]>();
  for (const ie of released) {
    const a = ie.npc_a_id as string;
    const b = ie.npc_b_id as string;
    if (isInternal(a) || isInternal(b)) continue;
    const ts = ie.in_game_timestamp as string | null;
    if (!ts) continue;
    const d = ie.relationship_deltas as {
      trust?: number;
      respect?: number;
      vibe?: number;
    } | null;
    const list = pairEvents.get(pairKey(a, b)) ?? [];
    list.push({
      day: inGameDayForTimestamp(ts),
      t: d?.trust ?? 0,
      r: d?.respect ?? 0,
      v: d?.vibe ?? 0,
    });
    pairEvents.set(pairKey(a, b), list);
  }

  // Baseline prior per pair = live value − sum(all released deltas). Replaying
  // forward from this baseline reproduces the live value at currentDay (the
  // deltas are tiny, so per-step clamping is a non-issue at these magnitudes).
  const pairBase = rels.map((r) => {
    const a = r.npc_a_id as string;
    const b = r.npc_b_id as string;
    const evList = pairEvents.get(pairKey(a, b)) ?? [];
    const tot = evList.reduce(
      (acc, e) => ({ t: acc.t + e.t, r: acc.r + e.r, v: acc.v + e.v }),
      { t: 0, r: 0, v: 0 },
    );
    return {
      a,
      b,
      base: {
        t: (r.trust as number) - tot.t,
        r: (r.respect as number) - tot.r,
        v: (r.vibe as number) - tot.v,
      },
      events: evList,
    };
  });

  const npcEdgesByDay: Record<string, TimelineEdge[]> = {};
  for (let d = 1; d <= currentDay; d++) {
    npcEdgesByDay[String(d)] = pairBase.map(({ a, b, base, events: evList }) => {
      let t = base.t;
      let r = base.r;
      let v = base.v;
      let changed = false;
      for (const e of evList) {
        if (e.day > d) continue;
        t += e.t;
        r += e.r;
        v += e.v;
        changed = true;
      }
      return toTimelineEdge(a, b, clamp(t), clamp(r), clamp(v), changed);
    });
  }

  const data: TimelineResponse = {
    currentDay,
    playerEdgesByDay,
    npcEdgesByDay,
  };
  memo = { sig, data };
  return NextResponse.json(data);
}
