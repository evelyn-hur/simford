import { createServiceRoleClient } from "@/lib/supabase/server";
import { endStaleConversationsForPlayer } from "@/lib/conversations";
import { getInGameDay } from "@/lib/gameState";
import { DEV_PLAYER_ID } from "@/lib/dev";
import CastCard, { type CastMember } from "@/components/CastCard";

export const dynamic = "force-dynamic";

/**
 * Loose archetype groupings, in display order. NPC ids are matched against
 * these; any NPC not listed falls into a trailing "Everyone else" group so new
 * characters never silently disappear.
 */
const GROUPS: { label: string; blurb: string; ids: string[] }[] = [
  {
    label: "Tech-adjacent",
    blurb: "Builders and researchers from the CS crowd.",
    ids: ["jake", "priya", "ben"],
  },
  {
    label: "Humanities & Arts",
    blurb: "Writers and makers who take the craft seriously.",
    ids: ["eliza", "june"],
  },
  {
    label: "Pre-professional",
    blurb: "Heads down, eyes on the offer.",
    ids: ["marcus", "alex", "maya"],
  },
  {
    label: "Athletes",
    blurb: "Two full-time lives at once.",
    ids: ["dj", "sasha"],
  },
  {
    label: "Wild cards",
    blurb: "They don't fit a box, and they like it that way.",
    ids: ["theo", "riya"],
  },
];

async function getCast(): Promise<CastMember[]> {
  const supabase = createServiceRoleClient();

  const [{ data: npcRows, error: npcError }, { data: relRows }, { data: convRows }] =
    await Promise.all([
      supabase
        .from("npcs")
        .select("id, name, archetype, speaking_style")
        .order("name", { ascending: true }),
      supabase
        .from("player_npc_relationships")
        .select("npc_id, trust, respect, vibe")
        .eq("player_id", DEV_PLAYER_ID),
      supabase
        .from("conversations")
        .select("id, npc_id")
        .eq("player_id", DEV_PLAYER_ID),
    ]);

  if (npcError) throw new Error(`Failed to load NPCs: ${npcError.message}`);

  // Relationship scores keyed by npc.
  const scoresByNpc = new Map(
    (relRows ?? []).map((r) => [
      r.npc_id as string,
      {
        trust: r.trust as number,
        respect: r.respect as number,
        vibe: r.vibe as number,
      },
    ]),
  );

  // Conversation rows get created empty on chat-page visits, so count only the
  // ones that have at least one message. Fetch the message-bearing conversation
  // ids, then tally per NPC.
  const convIdToNpc = new Map(
    (convRows ?? []).map((c) => [c.id as string, c.npc_id as string]),
  );
  const convCountByNpc = new Map<string, number>();
  const allConvIds = Array.from(convIdToNpc.keys());
  if (allConvIds.length > 0) {
    const { data: msgRows } = await supabase
      .from("messages")
      .select("conversation_id")
      .in("conversation_id", allConvIds);
    const nonEmpty = new Set(
      (msgRows ?? []).map((m) => m.conversation_id as string),
    );
    nonEmpty.forEach((cid) => {
      const npcId = convIdToNpc.get(cid);
      if (npcId) convCountByNpc.set(npcId, (convCountByNpc.get(npcId) ?? 0) + 1);
    });
  }

  return (npcRows ?? []).map((n) => ({
    id: n.id as string,
    name: n.name as string,
    archetype: n.archetype as string,
    voiceTag: (n.speaking_style as string) ?? "",
    scores: scoresByNpc.get(n.id as string) ?? null,
    conversationCount: convCountByNpc.get(n.id as string) ?? 0,
  }));
}

function groupCast(
  cast: CastMember[],
): { label: string; blurb: string; members: CastMember[] }[] {
  const byId = new Map(cast.map((c) => [c.id, c]));
  const used = new Set<string>();

  const groups = GROUPS.map((g) => {
    const members = g.ids
      .map((id) => byId.get(id))
      .filter((m): m is CastMember => Boolean(m));
    members.forEach((m) => used.add(m.id));
    return { label: g.label, blurb: g.blurb, members };
  }).filter((g) => g.members.length > 0);

  const leftover = cast.filter((c) => !used.has(c.id));
  if (leftover.length > 0)
    groups.push({ label: "Everyone else", blurb: "", members: leftover });

  return groups;
}

/** A small pixel stat chip used in the page header (Met X/12 · Day N). */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        background: "var(--panel-2)",
        border: "1.5px solid var(--line)",
        borderRadius: 14,
        padding: "9px 16px",
        textAlign: "center",
        minWidth: 64,
      }}
    >
      <div className="px tnum" style={{ fontSize: 20, color: "var(--accent)", lineHeight: 1 }}>
        {value}
      </div>
      <div
        className="px"
        style={{
          fontSize: 9.5,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          color: "var(--ink-3)",
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

export default async function Home() {
  // Safety net: judge any conversations abandoned without a clean end (hard
  // exit / timeout where the navigate-away beacon never fired). Fire-and-forget
  // so the landing page never waits on Sonnet; idempotent, so it races
  // harmlessly with the beacon and per-NPC stale-path. (Same serverless caveat
  // as other fire-and-forget calls — fine for local / long-lived runtimes.)
  void endStaleConversationsForPlayer(DEV_PLAYER_ID).catch((err) =>
    console.error("Home: stale-conversation sweep failed:", err),
  );

  const [cast, day] = await Promise.all([getCast(), getInGameDay(DEV_PLAYER_ID)]);
  const groups = groupCast(cast);
  const metCount = cast.filter((c) => c.scores != null).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <section
        style={{
          background: "var(--panel)",
          border: "2px solid var(--line-2)",
          borderRadius: "var(--r)",
          padding: "22px 24px",
          boxShadow: "var(--shadow-card)",
          display: "flex",
          flexWrap: "wrap",
          gap: 20,
          alignItems: "flex-end",
          justifyContent: "space-between",
          animation: "pop .3s ease both",
        }}
      >
        <div style={{ maxWidth: 560 }}>
          <div
            className="px"
            style={{ fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--accent)" }}
          >
            The Cast
          </div>
          <h1 className="px" style={{ fontSize: 30, margin: "6px 0 8px", lineHeight: 1.1 }}>
            Who are you talking to today?
          </h1>
          <p style={{ color: "var(--ink-2)", fontSize: 14.5, margin: 0 }}>
            Pick someone to talk to. Every conversation is remembered — they&rsquo;ll bring
            up what you said last time.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Stat value={`${metCount}/${cast.length}`} label="Met" />
          <Stat value={`${day}`} label="Day" />
        </div>
      </section>

      {cast.length === 0 && (
        <p style={{ color: "var(--ink-2)", marginTop: 18 }}>
          No NPCs yet. Run{" "}
          <code
            style={{
              background: "var(--panel-3)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: "1px 6px",
            }}
          >
            npx tsx scripts/seed-npcs.ts
          </code>
          .
        </p>
      )}

      {groups.map((group) => (
        <section key={group.label} style={{ marginTop: 26 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            <h2
              className="px"
              style={{
                fontSize: 14,
                textTransform: "uppercase",
                letterSpacing: 1.2,
                margin: 0,
                whiteSpace: "nowrap",
              }}
            >
              {group.label}
            </h2>
            {group.blurb && (
              <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{group.blurb}</span>
            )}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))",
              gap: 16,
            }}
          >
            {group.members.map((npc) => (
              <CastCard key={npc.id} npc={npc} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
