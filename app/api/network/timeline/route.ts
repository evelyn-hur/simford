import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { computeDerivedMetrics } from "@/lib/relationships";
import { DEV_PLAYER_ID } from "@/lib/dev";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLAYER_ID = "player";
const PRIOR = 0.5; // player↔NPC relationships start neutral
const clamp = (n: number) => Math.min(1, Math.max(0, n));

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
}

export interface TimelineResponse {
  currentDay: number;
  /** Player↔NPC edges as of each in-game day (1 → currentDay). */
  playerEdgesByDay: Record<string, TimelineEdge[]>;
}

// Server-side memo so repeated page loads don't recompute. Invalidated when the
// day advances or new relationship_events land (signature changes).
let memo: { sig: string; data: TimelineResponse } | null = null;

/**
 * GET /api/network/timeline — historical player↔NPC relationship snapshots.
 *
 * For each in-game day, replays relationship_events (player-scoped deltas) up to
 * that day, starting from neutral priors and clamping each step — so day N
 * reproduces the live state and earlier days show the relationships as they were.
 * NPC↔NPC relationships have no events, so they stay at their seeded priors at
 * every day (the client keeps those constant).
 */
export async function GET() {
  const supabase = createServiceRoleClient();

  const [{ data: gs }, { data: events, error: evErr }] = await Promise.all([
    supabase
      .from("game_state")
      .select("in_game_day")
      .eq("player_id", DEV_PLAYER_ID)
      .maybeSingle(),
    supabase
      .from("relationship_events")
      .select("id, npc_id, delta_trust, delta_respect, delta_vibe, conversation_id, created_at")
      .eq("player_id", DEV_PLAYER_ID)
      .order("created_at", { ascending: true }),
  ]);

  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });

  const currentDay = Math.max(1, (gs?.in_game_day as number) ?? 1);
  const evs = events ?? [];

  const sig = `${currentDay}|${evs.length}|${evs[evs.length - 1]?.id ?? ""}`;
  if (memo?.sig === sig) return NextResponse.json(memo.data);

  // Map each event to an in-game day via its conversation's messages (events
  // have no in_game_day column; the conversation's turns do).
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

  // Replay events up to each day.
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
      ([npc, s]) => {
        const dm = computeDerivedMetrics(s.t, s.r, s.v);
        return {
          source: PLAYER_ID,
          target: npc,
          trust: s.t,
          respect: s.r,
          vibe: s.v,
          cofounder_score: dm.cofounder_score,
          close_friend_score: dm.close_friend_score,
          study_partner_score: dm.study_partner_score,
          frenemy_score: dm.frenemy_score,
        };
      },
    );
  }

  const data: TimelineResponse = { currentDay, playerEdgesByDay };
  memo = { sig, data };
  return NextResponse.json(data);
}
