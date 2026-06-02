import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { computeDerivedMetrics } from "@/lib/relationships";
import { archetypeGroup, type ArchetypeGroup } from "@/lib/archetypes";
import { DEV_PLAYER_ID } from "@/lib/dev";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLAYER_ID = "player";

export interface NetworkNode {
  id: string;
  name: string;
  archetype: string;
  // "player" marks the (distinctively-styled) player node; otherwise an archetype group.
  archetypeGroup: ArchetypeGroup | "player";
  /** One-line voice flavor (from `speaking_style`), for the hover tooltip. */
  voiceTag: string;
}

export interface NetworkEdge {
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

export interface NetworkResponse {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

/**
 * GET /api/network — graph data for the relationship network.
 * Nodes are NPCs (with a color-coding archetypeGroup); edges are the undirected
 * NPC↔NPC relationships with their primitives plus computed derived metrics.
 */
export async function GET() {
  const supabase = createServiceRoleClient();

  const [
    { data: npcs, error: npcErr },
    { data: rels, error: relErr },
    { data: playerRels, error: playerErr },
  ] = await Promise.all([
    supabase
      .from("npcs")
      .select("id, name, archetype, speaking_style")
      .order("name"),
    supabase
      .from("npc_npc_relationships")
      .select("npc_a_id, npc_b_id, trust, respect, vibe"),
    supabase
      .from("player_npc_relationships")
      .select("npc_id, trust, respect, vibe")
      .eq("player_id", DEV_PLAYER_ID),
  ]);

  if (npcErr) {
    return NextResponse.json({ error: npcErr.message }, { status: 500 });
  }
  if (relErr) {
    return NextResponse.json({ error: relErr.message }, { status: 500 });
  }
  if (playerErr) {
    return NextResponse.json({ error: playerErr.message }, { status: 500 });
  }

  // Exclude internal test fixtures (ids like "__memtest__" / "__evaltest__"
  // created by the eval/test scripts) — they aren't part of the character cast.
  const isInternal = (id: string) => id.startsWith("__");

  const nodes: NetworkNode[] = (npcs ?? [])
    .filter((n) => !isInternal(n.id as string))
    .map((n) => {
      const archetype = n.archetype as string;
      return {
        id: n.id as string,
        name: n.name as string,
        archetype,
        archetypeGroup: archetypeGroup(archetype),
        voiceTag: (n.speaking_style as string) ?? "",
      };
    });

  const nodeIds = new Set(nodes.map((n) => n.id));

  // The player as a distinctively-styled node. Always returned; the client
  // toggles its visibility ("Show player").
  nodes.push({
    id: PLAYER_ID,
    name: "You",
    archetype: "the player",
    archetypeGroup: "player",
    voiceTag: "Your relationships across the cast.",
  });

  const toEdge = (
    source: string,
    target: string,
    trust: number,
    respect: number,
    vibe: number,
  ): NetworkEdge => {
    const d = computeDerivedMetrics(trust, respect, vibe);
    return {
      source,
      target,
      trust,
      respect,
      vibe,
      cofounder_score: d.cofounder_score,
      close_friend_score: d.close_friend_score,
      study_partner_score: d.study_partner_score,
      frenemy_score: d.frenemy_score,
    };
  };

  // NPC↔NPC edges (both endpoints must be real nodes — drops any dangling
  // relationship that referenced a filtered-out fixture).
  const npcEdges: NetworkEdge[] = (rels ?? [])
    .filter(
      (r) =>
        nodeIds.has(r.npc_a_id as string) &&
        nodeIds.has(r.npc_b_id as string),
    )
    .map((r) =>
      toEdge(
        r.npc_a_id as string,
        r.npc_b_id as string,
        r.trust as number,
        r.respect as number,
        r.vibe as number,
      ),
    );

  // Player↔NPC edges from the player's relationship state (only NPCs they've
  // actually built a relationship with appear).
  const playerEdges: NetworkEdge[] = (playerRels ?? [])
    .filter((r) => nodeIds.has(r.npc_id as string))
    .map((r) =>
      toEdge(
        PLAYER_ID,
        r.npc_id as string,
        r.trust as number,
        r.respect as number,
        r.vibe as number,
      ),
    );

  const body: NetworkResponse = {
    nodes,
    edges: [...npcEdges, ...playerEdges],
  };
  return NextResponse.json(body);
}
