import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { inGameDayForTimestamp } from "@/lib/gameTime";
import { DEV_PLAYER_ID } from "@/lib/dev";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 5;

export interface RecentChange {
  /** In-game day the event occurred (from the linked inter_npc_event), or null. */
  day: number | null;
  npcA: { id: string; name: string };
  npcB: { id: string; name: string };
  deltas: { trust: number; respect: number; vibe: number };
  content: string | null;
  location: string | null;
}

export interface RecentChangesResponse {
  currentDay: number;
  changes: RecentChange[];
}

/**
 * GET /api/network/recent-changes — the current in-game day plus the latest
 * system-driven (NPC↔NPC) relationship changes, for the "Recent network
 * changes" panel. Also the lightweight poll source the /network page uses to
 * detect day advances. System rows are relationship_events with player_id NULL;
 * each links to the inter_npc_event that caused it (for content/location/day).
 */
export async function GET() {
  const supabase = createServiceRoleClient();

  const [{ data: gs }, { data: rows, error }, { data: npcs }] =
    await Promise.all([
      supabase
        .from("game_state")
        .select("in_game_day")
        .eq("player_id", DEV_PLAYER_ID)
        .maybeSingle(),
      supabase
        .from("relationship_events")
        .select(
          "npc_id, npc_b_id, delta_trust, delta_respect, delta_vibe, inter_npc_event_id, created_at",
        )
        .is("player_id", null)
        .order("created_at", { ascending: false })
        .limit(LIMIT),
      supabase.from("npcs").select("id, name"),
    ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const currentDay = Math.max(1, (gs?.in_game_day as number) ?? 1);

  // NPC id → display name.
  const nameById = new Map<string, string>();
  for (const n of npcs ?? []) nameById.set(n.id as string, n.name as string);
  const named = (id: string | null) => ({
    id: id ?? "",
    name: (id && nameById.get(id)) || id || "",
  });

  // Resolve the causing events in one query (avoids relying on the PostgREST FK
  // cache right after the migration).
  const eventIds = Array.from(
    new Set(
      (rows ?? [])
        .map((r) => r.inter_npc_event_id as string | null)
        .filter(Boolean),
    ),
  ) as string[];

  const evById = new Map<
    string,
    { content: string | null; location: string | null; ts: string | null }
  >();
  if (eventIds.length > 0) {
    const { data: evs } = await supabase
      .from("inter_npc_events")
      .select("id, content, location, in_game_timestamp")
      .in("id", eventIds);
    for (const e of evs ?? []) {
      evById.set(e.id as string, {
        content: (e.content as string | null) ?? null,
        location: (e.location as string | null) ?? null,
        ts: (e.in_game_timestamp as string | null) ?? null,
      });
    }
  }

  const changes: RecentChange[] = (rows ?? []).map((r) => {
    const ev = evById.get(r.inter_npc_event_id as string);
    return {
      day: ev?.ts ? inGameDayForTimestamp(ev.ts) : null,
      npcA: named(r.npc_id as string | null),
      npcB: named(r.npc_b_id as string | null),
      deltas: {
        trust: (r.delta_trust as number) ?? 0,
        respect: (r.delta_respect as number) ?? 0,
        vibe: (r.delta_vibe as number) ?? 0,
      },
      content: ev?.content ?? null,
      location: ev?.location ?? null,
    };
  });

  const body: RecentChangesResponse = { currentDay, changes };
  return NextResponse.json(body);
}
