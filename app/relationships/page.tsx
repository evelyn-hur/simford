import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { computeDerivedMetrics } from "@/lib/relationships";
import RelationshipsTable, { type PairRow } from "@/components/RelationshipsTable";

export const dynamic = "force-dynamic";

async function getPairs(): Promise<PairRow[]> {
  const supabase = createServiceRoleClient();
  const [{ data: rels, error }, { data: npcs }] = await Promise.all([
    supabase
      .from("npc_npc_relationships")
      .select("npc_a_id, npc_b_id, trust, respect, vibe, archetype_affinity_prior"),
    supabase.from("npcs").select("id, name"),
  ]);

  if (error) throw new Error(`Failed to load relationships: ${error.message}`);

  const nameById = new Map((npcs ?? []).map((n) => [n.id as string, n.name as string]));
  const firstName = (id: string) => (nameById.get(id) ?? id).split(/\s+/)[0];

  return (rels ?? []).map((r) => {
    const trust = r.trust as number;
    const respect = r.respect as number;
    const vibe = r.vibe as number;
    const d = computeDerivedMetrics(trust, respect, vibe);
    return {
      a: firstName(r.npc_a_id as string),
      b: firstName(r.npc_b_id as string),
      trust,
      respect,
      vibe,
      affinity: r.archetype_affinity_prior as number,
      cofounder: d.cofounder_score,
      close_friend: d.close_friend_score,
      study_partner: d.study_partner_score,
      frenemy: d.frenemy_score,
    };
  });
}

export default async function RelationshipsPage() {
  const pairs = await getPairs();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">
            NPC relationships
          </h1>
          <Link href="/" className="text-sm text-neutral-400 transition hover:text-cardinal">
            ← Back
          </Link>
        </div>
        <p className="max-w-prose text-neutral-600">
          All {pairs.length} NPC-to-NPC pairs with their primitives (trust /
          respect / vibe / archetype affinity) and derived metrics. Click a
          column to sort.
        </p>
        <p className="text-xs text-neutral-400">
          Inspection view — a proper visualization is coming. Derived columns
          recompute from the primitives via{" "}
          <code className="rounded bg-neutral-100 px-1">computeDerivedMetrics</code>.
        </p>
      </header>

      {pairs.length === 0 ? (
        <p className="text-neutral-500">
          No relationships yet. Run{" "}
          <code className="rounded bg-neutral-100 px-1">
            npx tsx scripts/seed-npc-relationships.ts
          </code>
          .
        </p>
      ) : (
        <RelationshipsTable rows={pairs} />
      )}
    </div>
  );
}
