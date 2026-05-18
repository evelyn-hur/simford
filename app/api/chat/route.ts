import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  retrieveMemories,
  summarizeConversationAsMemory,
  type Memory,
} from "@/lib/memory";
import type { ChatMessage } from "@/lib/conversations";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;
// How many prior messages to feed back to the model as context.
const HISTORY_LIMIT = 30;
// How many recent messages to embed as the memory-retrieval query.
const RETRIEVAL_CONTEXT_MESSAGES = 3;
// How many memories to retrieve.
const RETRIEVAL_TOP_K = 5;
// How many recent messages to summarize into memory after a turn.
const SUMMARY_WINDOW = 6;

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

function daysAgo(createdAt: string): number {
  const ms = Date.now() - new Date(createdAt).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export async function POST(req: Request) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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

    // 3. Retrieve relevant memories. The query is the current message plus
    //    the last few messages of context. Retrieval failure degrades to
    //    "no memories" rather than failing the whole chat.
    const contextTail = orderedHistory
      .slice(-RETRIEVAL_CONTEXT_MESSAGES)
      .map(
        (m) =>
          `${m.role === "player" ? "Player" : "You"}: ${m.content as string}`,
      );
    const queryText = [...contextTail, `Player: ${message}`].join("\n");

    let memories: Memory[] = [];
    try {
      memories = await retrieveMemories({
        npcId: npc.id,
        queryText,
        topK: RETRIEVAL_TOP_K,
      });
    } catch (err) {
      console.error("retrieveMemories failed (continuing without):", err);
    }

    // 4. Build the system prompt: identity, then a memories section (only if
    //    non-empty — skip the header entirely on cold start), then history
    //    is supplied separately as the message array.
    let system = `${npc.identity_prompt}\n\nSpeaking style: ${npc.speaking_style}`;
    if (memories.length > 0) {
      const memoryLines = memories
        .map(
          (m) =>
            `- ${m.content} (importance: ${m.importance}/10, recalled because: similar topic and recent)`,
        )
        .join("\n");
      system +=
        `\n\nRELEVANT MEMORIES (your own past observations, ordered by relevance):\n` +
        memoryLines;
    }

    const messages: Anthropic.MessageParam[] = [
      ...orderedHistory.map((m) => ({
        role: toAnthropicRole(m.role as DbRole),
        content: m.content as string,
      })),
      { role: "user" as const, content: message },
    ];

    // 5. Call Claude Haiku 4.5.
    const completion = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
    });

    const reply = completion.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!reply) {
      return NextResponse.json(
        { error: "Model returned no text content" },
        { status: 502 },
      );
    }

    // 6. Persist both turns. Insert the player message first so its
    //    created_at precedes the NPC reply (messages are ordered by it).
    const { error: playerInsertError } = await supabase
      .from("messages")
      .insert({ conversation_id, role: "player", content: message });

    if (playerInsertError) {
      return NextResponse.json(
        {
          error: `Failed to save player message: ${playerInsertError.message}`,
        },
        { status: 500 },
      );
    }

    const { error: npcInsertError } = await supabase.from("messages").insert({
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

    // 7. Fire-and-forget: summarize the last few turns into memory. Do not
    //    await — the response must not block on this. (Caveat: on a
    //    serverless platform the function may freeze after responding; if
    //    summaries go missing in prod, move this to a queue/after-response
    //    hook. Fine for local/long-lived runtimes.)
    const summaryWindow: ChatMessage[] = [
      ...orderedHistory.map(
        (m): ChatMessage => ({
          role: m.role as DbRole,
          content: m.content as string,
        }),
      ),
      { role: "player" as const, content: message },
      { role: "npc" as const, content: reply },
    ].slice(-SUMMARY_WINDOW);

    void summarizeConversationAsMemory({
      npcId: npc.id,
      messages: summaryWindow,
      conversationId: conversation_id,
    }).catch((err) => {
      console.error("summarizeConversationAsMemory failed:", err);
    });

    // 8. Respond, including retrieved-memory metadata for the UI.
    const memoriesUsed = memories.map((m) => ({
      content: m.content,
      importance: m.importance,
      similarity: Number(m.similarity.toFixed(4)),
      recency: Number(m.recency.toFixed(4)),
      compositeScore: Number(m.compositeScore.toFixed(4)),
      daysAgo: daysAgo(m.createdAt),
    }));

    return NextResponse.json({
      // `response` per spec; `reply` kept for backward compat with the
      // existing ChatClient (which reads `data.reply`).
      response: reply,
      reply,
      memoriesUsed,
      usage: {
        input_tokens: completion.usage.input_tokens,
        output_tokens: completion.usage.output_tokens,
      },
    });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Chat failed: ${messageText}` },
      { status: 500 },
    );
  }
}
