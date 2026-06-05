import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  getThreadMessages,
  getOrCreateConversation,
} from "@/lib/conversations";
import { DEV_PLAYER_ID } from "@/lib/dev";
import { getInGameDay } from "@/lib/gameState";
import { SpriteStage } from "@/components/pixel";
import ChatClient from "@/components/ChatClient";
import GameClock from "@/components/GameClock";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  params,
}: {
  params: { npcId: string };
}) {
  const { npcId } = params;

  const supabase = createServiceRoleClient();
  const { data: npc, error } = await supabase
    .from("npcs")
    .select("id, name, archetype")
    .eq("id", npcId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load NPC: ${error.message}`);
  if (!npc) notFound();

  const conversationId = await getOrCreateConversation(npc.id);
  // Full cross-conversation thread (all past + the current open one) so the
  // chat displays every message ever exchanged with this NPC, with iMessage-
  // style dividers between conversations / days.
  const initialMessages = await getThreadMessages(DEV_PLAYER_ID, npc.id);

  // Current relationship scores (start state for the meters); default 0.5s.
  const { data: rel } = await supabase
    .from("player_npc_relationships")
    .select("trust, respect, vibe")
    .eq("player_id", DEV_PLAYER_ID)
    .eq("npc_id", npc.id)
    .maybeSingle();
  const initialScores = {
    trust: (rel?.trust as number) ?? 0.5,
    respect: (rel?.respect as number) ?? 0.5,
    vibe: (rel?.vibe as number) ?? 0.5,
  };

  const inGameDay = await getInGameDay(DEV_PLAYER_ID);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Chat header bar */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          background: "var(--panel)",
          border: "2px solid var(--line-2)",
          borderRadius: "var(--r)",
          boxShadow: "var(--shadow-card)",
          padding: "10px 16px",
        }}
      >
        <Link
          href="/"
          aria-label="Back to all NPCs"
          className="px"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 38,
            height: 38,
            flex: "0 0 auto",
            borderRadius: 11,
            border: "2px solid var(--line-2)",
            background: "var(--panel)",
            color: "var(--ink)",
            boxShadow: "var(--shadow-btn)",
            textDecoration: "none",
            fontSize: 16,
          }}
        >
          ←
        </Link>

        <div style={{ flex: "0 0 auto" }}>
          <SpriteStage id={npc.id} scale={2.4} pad={7} round={12} />
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="px" style={{ fontSize: 16, lineHeight: 1.15 }}>
            {npc.name}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{npc.archetype}</div>
        </div>

        <GameClock initialDay={inGameDay} conversationId={conversationId} />
      </header>

      <ChatClient
        npcId={npc.id}
        npcName={npc.name}
        conversationId={conversationId}
        initialMessages={initialMessages}
        initialScores={initialScores}
      />
    </div>
  );
}
