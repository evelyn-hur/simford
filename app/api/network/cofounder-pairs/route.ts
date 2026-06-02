import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { computeDerivedMetrics } from "@/lib/relationships";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOP_N = 3;

export interface CofounderPair {
  a: string;
  b: string;
  aName: string;
  bName: string;
  cofounder_score: number;
  trust: number;
  respect: number;
  vibe: number;
}

/**
 * GET /api/network/cofounder-pairs — the top cofounder pairs.
 * Computes cofounder_score for every NPC↔NPC pair and returns the top 3 with
 * their primitives. (No LLM involved.)
 */
export async function GET() {
  const supabase = createServiceRoleClient();

  const [{ data: rels, error: relErr }, { data: npcs, error: npcErr }] =
    await Promise.all([
      supabase
        .from("npc_npc_relationships")
        .select("npc_a_id, npc_b_id, trust, respect, vibe"),
      supabase.from("npcs").select("id, name"),
    ]);

  if (relErr) return NextResponse.json({ error: relErr.message }, { status: 500 });
  if (npcErr) return NextResponse.json({ error: npcErr.message }, { status: 500 });

  const nameById = new Map(
    (npcs ?? []).map((n) => [n.id as string, n.name as string]),
  );
  const isInternal = (id: string) => id.startsWith("__");

  const pairs: CofounderPair[] = (rels ?? [])
    .filter(
      (r) => !isInternal(r.npc_a_id as string) && !isInternal(r.npc_b_id as string),
    )
    .map((r) => {
      const trust = r.trust as number;
      const respect = r.respect as number;
      const vibe = r.vibe as number;
      const { cofounder_score } = computeDerivedMetrics(trust, respect, vibe);
      return {
        a: r.npc_a_id as string,
        b: r.npc_b_id as string,
        aName: nameById.get(r.npc_a_id as string) ?? (r.npc_a_id as string),
        bName: nameById.get(r.npc_b_id as string) ?? (r.npc_b_id as string),
        cofounder_score,
        trust,
        respect,
        vibe,
      };
    })
    .sort((x, y) => y.cofounder_score - x.cofounder_score)
    .slice(0, TOP_N);

  return NextResponse.json({ pairs });
}
