import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;
// How many prior messages to feed back to the model as context.
const HISTORY_LIMIT = 30;

type DbRole = "player" | "npc";

interface ChatRequestBody {
  npc_id: string;
  conversation_id: string;
  message: string;
}

// DB role -> Anthropic role.
function toAnthropicRole(role: DbRole): "user" | "assistant" {
  return role === "player" ? "user" : "assistant";
}

export async function POST(req: Request) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { npc_id, conversation_id, message } = body ?? {};
  if (!npc_id || !conversation_id || !message?.trim()) {
    return NextResponse.json(
      { error: "npc_id, conversation_id, and message are required" },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();

  try {
    // 1. Fetch the NPC's identity prompt.
    const { data: npc, error: npcError } = await supabase
      .from("npcs")
      .select("id, identity_prompt, speaking_style")
      .eq("id", npc_id)
      .single();

    if (npcError || !npc) {
      return NextResponse.json(
        { error: `NPC '${npc_id}' not found` },
        { status: 404 },
      );
    }

    // 2. Fetch recent message history for this conversation (chronological).
    const { data: history, error: historyError } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);

    if (historyError) {
      return NextResponse.json(
        { error: `Failed to load history: ${historyError.message}` },
        { status: 500 },
      );
    }

    const orderedHistory = (history ?? []).slice().reverse();

    const messages: Anthropic.MessageParam[] = [
      ...orderedHistory.map((m) => ({
        role: toAnthropicRole(m.role as DbRole),
        content: m.content as string,
      })),
      { role: "user" as const, content: message },
    ];

    // 3. Call Claude Haiku 4.5.
    const system = `${npc.identity_prompt}\n\nSpeaking style: ${npc.speaking_style}`;

    const completion = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
    });

    const reply = completion.content
      .filter(
        (block): block is Anthropic.TextBlock => block.type === "text",
      )
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!reply) {
      return NextResponse.json(
        { error: "Model returned no text content" },
        { status: 502 },
      );
    }

    // 4. Persist both turns. Insert the player message first so its
    //    created_at precedes the NPC reply (messages are ordered by it).
    const { error: playerInsertError } = await supabase
      .from("messages")
      .insert({
        conversation_id,
        role: "player",
        content: message,
      });

    if (playerInsertError) {
      return NextResponse.json(
        { error: `Failed to save player message: ${playerInsertError.message}` },
        { status: 500 },
      );
    }

    const { error: npcInsertError } = await supabase
      .from("messages")
      .insert({
        conversation_id,
        role: "npc",
        content: reply,
        tokens_in: completion.usage.input_tokens,
        tokens_out: completion.usage.output_tokens,
      });

    if (npcInsertError) {
      return NextResponse.json(
        { error: `Failed to save NPC message: ${npcInsertError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      reply,
      usage: {
        input_tokens: completion.usage.input_tokens,
        output_tokens: completion.usage.output_tokens,
      },
    });
  } catch (err) {
    const messageText =
      err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Chat failed: ${messageText}` },
      { status: 500 },
    );
  }
}
