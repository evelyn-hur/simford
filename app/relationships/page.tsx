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
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section
        style={{
          background: "var(--panel)",
          border: "2px solid var(--line-2)",
          borderRadius: "var(--r)",
          padding: "22px 24px",
          boxShadow: "var(--shadow-card)",
          animation: "pop .3s ease both",
        }}
      >
        <div
          className="px"
          style={{ fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--accent)" }}
        >
          Bonds
        </div>
        <h1 className="px" style={{ fontSize: 30, margin: "6px 0 8px", lineHeight: 1.1 }}>
          The web between them
        </h1>
        <p style={{ color: "var(--ink-2)", fontSize: 14.5, margin: 0, maxWidth: 680 }}>
          All {pairs.length} NPC-to-NPC pairs — their primitives (trust / respect / vibe / archetype
          affinity) and the derived metrics (cofounder, close-friend, study-partner, frenemy) that
          recompute from them. Click a column to sort.
        </p>
      </section>

      {pairs.length === 0 ? (
        <p style={{ color: "var(--ink-2)" }}>
          No relationships yet. Run{" "}
          <code
            style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, padding: "1px 6px" }}
          >
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
