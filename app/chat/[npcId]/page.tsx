import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  getMessages,
  getOrCreateConversation,
} from "@/lib/conversations";
import NpcAvatar from "@/components/NpcAvatar";
import ChatClient from "@/components/ChatClient";

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
  const initialMessages = await getMessages(conversationId);

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-neutral-200 pb-4">
        <Link
          href="/"
          className="text-sm text-neutral-400 transition hover:text-cardinal"
          aria-label="Back to all NPCs"
        >
          ←
        </Link>
        <NpcAvatar name={npc.name} size="md" />
        <div className="min-w-0">
          <p className="truncate font-semibold text-neutral-900">
            {npc.name}
          </p>
          <p className="truncate text-sm text-neutral-500">{npc.archetype}</p>
        </div>
      </div>

      <ChatClient
        npcId={npc.id}
        conversationId={conversationId}
        initialMessages={initialMessages}
      />
    </div>
  );
}
