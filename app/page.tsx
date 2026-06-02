import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { endStaleConversationsForPlayer } from "@/lib/conversations";
import { DEV_PLAYER_ID } from "@/lib/dev";
import NpcAvatar from "@/components/NpcAvatar";

export const dynamic = "force-dynamic";

interface CastMember {
  id: string;
  name: string;
  archetype: string;
  /** One-line voice flavor (from `speaking_style`). */
  voiceTag: string;
  /** Present only once the player has interacted (a relationship row exists). */
  scores: { trust: number; respect: number; vibe: number } | null;
  /** Number of past conversations that actually contain messages. */
  conversationCount: number;
}

/**
 * Loose archetype groupings, in display order. NPC ids are matched against
 * these; any NPC not listed falls into a trailing "Everyone else" group so new
 * characters never silently disappear.
 */
const GROUPS: { label: string; ids: string[] }[] = [
  { label: "Tech-adjacent", ids: ["jake", "priya", "ben"] },
  { label: "Humanities & Arts", ids: ["eliza", "june"] },
  { label: "Pre-professional", ids: ["marcus", "alex", "maya"] },
  { label: "Athletes", ids: ["dj", "sasha"] },
  { label: "Wild cards", ids: ["theo", "riya"] },
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

function groupCast(cast: CastMember[]): { label: string; members: CastMember[] }[] {
  const byId = new Map(cast.map((c) => [c.id, c]));
  const used = new Set<string>();

  const groups = GROUPS.map((g) => {
    const members = g.ids
      .map((id) => byId.get(id))
      .filter((m): m is CastMember => Boolean(m));
    members.forEach((m) => used.add(m.id));
    return { label: g.label, members };
  }).filter((g) => g.members.length > 0);

  const leftover = cast.filter((c) => !used.has(c.id));
  if (leftover.length > 0) groups.push({ label: "Everyone else", members: leftover });

  return groups;
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className="flex items-center gap-2"
      aria-label={`${label}: ${pct} percent`}
    >
      <span className="w-12 shrink-0 text-[11px] uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
        <div
          className="h-full rounded-full bg-cardinal/80"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-neutral-400">
        {pct}
      </span>
    </div>
  );
}

function NpcCard({ npc }: { npc: CastMember }) {
  const { scores, conversationCount } = npc;
  return (
    <Link
      href={`/chat/${npc.id}`}
      className="group flex h-full flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-cardinal/30 hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <NpcAvatar name={npc.name} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-neutral-900">{npc.name}</p>
          <p className="truncate text-sm text-neutral-500">{npc.archetype}</p>
        </div>
      </div>

      {npc.voiceTag && (
        <p className="line-clamp-2 text-sm italic leading-snug text-neutral-500">
          &ldquo;{npc.voiceTag}&rdquo;
        </p>
      )}

      <div className="mt-auto space-y-3 pt-1">
        {scores ? (
          <div className="space-y-1.5">
            <ScoreBar label="Trust" value={scores.trust} />
            <ScoreBar label="Respect" value={scores.respect} />
            <ScoreBar label="Vibe" value={scores.vibe} />
          </div>
        ) : conversationCount === 0 ? (
          <p className="text-xs text-neutral-400">You haven&rsquo;t met yet</p>
        ) : null}

        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-400">
            {conversationCount > 0
              ? `${conversationCount} conversation${conversationCount === 1 ? "" : "s"}`
              : ""}
          </span>
          <span className="text-sm font-medium text-cardinal opacity-0 transition group-hover:opacity-100">
            {conversationCount > 0 ? "Continue →" : "Start →"}
          </span>
        </div>
      </div>
    </Link>
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

  const cast = await getCast();
  const groups = groupCast(cast);

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Simford</h1>
        <p className="max-w-prose text-neutral-600">
          Pick someone to talk to. Conversations are remembered.
        </p>
      </header>

      {cast.length === 0 && (
        <p className="text-neutral-500">
          No NPCs yet. Run{" "}
          <code className="rounded bg-neutral-100 px-1">
            npx tsx scripts/seed-npcs.ts
          </code>
          .
        </p>
      )}

      {groups.map((group) => (
        <section key={group.label} className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-neutral-400">
            {group.label}
          </h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {group.members.map((npc) => (
              <NpcCard key={npc.id} npc={npc} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
