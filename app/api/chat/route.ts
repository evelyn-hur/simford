import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  retrieveMemories,
  summarizeConversationAsMemory,
  type Memory,
} from "@/lib/memory";
import {
  buildRelationshipGuidance,
  type RelationshipScores,
} from "@/lib/relationships";
import type { ChatMessage } from "@/lib/conversations";
import {
  inGameTimestampForDay,
  inGameDayForTimestamp,
  weekOfQuarter,
} from "@/lib/gameTime";
import { isBaselineMode, EVAL_MODE_HEADER } from "@/lib/evalMode";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
// Hard cap on reply length. Keeps the model honest about the "1–3 sentences,
// up to 5 max" rule when it would otherwise drift into long monologues even
// after the prompt forbids it. ~250 = comfortable for 5 typical sentences
// without mid-sentence truncation; longer attempts get cut.
const MAX_TOKENS = 260;
// Lower temperature tightens instruction-following — Haiku at 1.0 is eager to
// expand on emotional moments even when the prompt forbids it.
const TEMPERATURE = 0.5;
// How many prior messages to feed back to the model as context.
const HISTORY_LIMIT = 30;
// How many recent messages to embed as the memory-retrieval query.
const RETRIEVAL_CONTEXT_MESSAGES = 3;
// How many memories to retrieve.
const RETRIEVAL_TOP_K = 5;
// How many recent inter-NPC events to surface as "recent social context"
// (fetched by recency, independent of the query — see step 3b).
const RECENT_SOCIAL_CONTEXT_LIMIT = 3;
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

  // Baseline (ablation) mode: a stateless NPC — identity prompt + this
  // conversation's in-session messages only, with NO memory retrieval, NO
  // relationship state, and NO off-screen social context injected. The
  // X-Eval-Mode header overrides BASELINE_MODE so eval runs flip it per
  // request. Background memory writes + end-of-conversation judging still run.
  const baselineMode = isBaselineMode(req);

  const supabase = createServiceRoleClient();

  try {
    // 1. Fetch the NPC's identity prompt.
    const { data: npc, error: npcError } = await supabase
      .from("npcs")
      .select("id, identity_prompt, speaking_style, identity_keywords")
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
      .select("role, content, created_at, in_game_day")
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

    // 2b. Identify the player (the conversation's owner) and load the current
    //     relationship scores — default 0.5s if there's no row yet. These
    //     reflect state as of the START of this turn and are returned to the
    //     UI; the deltas judged below apply going forward.
    const { data: conversation } = await supabase
      .from("conversations")
      .select("player_id")
      .eq("id", conversation_id)
      .maybeSingle();
    const playerId = conversation?.player_id as string | undefined;

    let currentScores: RelationshipScores = {
      trust: 0.5,
      respect: 0.5,
      vibe: 0.5,
    };
    if (playerId) {
      const { data: rel } = await supabase
        .from("player_npc_relationships")
        .select("trust, respect, vibe")
        .eq("player_id", playerId)
        .eq("npc_id", npc_id)
        .maybeSingle();
      if (rel) {
        currentScores = {
          trust: rel.trust as number,
          respect: rel.respect as number,
          vibe: rel.vibe as number,
        };
      }
    }

    // 2c. Current in-game day → in-game "now". Used for memory recency (so it
    //     decays over in-game time) and as the in_game_timestamp for memories
    //     written this turn.
    let inGameDay = 1;
    if (playerId) {
      const { data: gs } = await supabase
        .from("game_state")
        .select("in_game_day")
        .eq("player_id", playerId)
        .maybeSingle();
      if (gs) inGameDay = gs.in_game_day as number;
    }
    const nowInGame = inGameTimestampForDay(inGameDay);

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
    // Baseline mode does NOT retrieve from memory_stream (the stateless
    // ablation). Background memory WRITES still run after the turn, so an A/B
    // comparison can recover what retrieval would have surfaced.
    if (!baselineMode) {
      try {
        memories = await retrieveMemories({
          npcId: npc.id,
          queryText,
          topK: RETRIEVAL_TOP_K,
          nowInGame,
          identityKeywords: (npc.identity_keywords as string[]) ?? [],
        });
      } catch (err) {
        console.error("retrieveMemories failed (continuing without):", err);
      }
    }

    // 3b. Recent social context: the NPC's most recent off-screen inter-NPC
    //     events, fetched by recency ALONE (not similarity) so the NPC can
    //     bring up recent social happenings even when they're unrelated to the
    //     current topic. Only events that have already occurred by the current
    //     in-game day (in_game_timestamp <= now) — never reference the future.
    //     Degrades to "none" on error, like memory retrieval.
    //     (Note: once lib/events.ts releases these into memory_stream too, an
    //     event could in principle appear both here and in RELEVANT MEMORIES;
    //     harmless reinforcement, and dedupe can live in the release path.)
    interface SocialEvent {
      content: string;
      location: string | null;
      in_game_timestamp: string;
    }
    let socialEvents: SocialEvent[] = [];
    // Off-screen inter-NPC events are cross-session world state, so baseline
    // mode ("in-session context only") omits them too.
    if (!baselineMode) {
      try {
        const { data: ev } = await supabase
          .from("inter_npc_events")
          .select("content, location, in_game_timestamp")
          .or(`npc_a_id.eq.${npc.id},npc_b_id.eq.${npc.id}`)
          .lte("in_game_timestamp", nowInGame)
          .order("in_game_timestamp", { ascending: false })
          .limit(RECENT_SOCIAL_CONTEXT_LIMIT);
        socialEvents = (ev ?? []) as SocialEvent[];
      } catch (err) {
        console.error("recent social context fetch failed (continuing without):", err);
      }
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

    // Recent social context: phrased as "things that happened to you", with an
    // in-game "when" (today / yesterday / N days ago) and the place. The NPC is
    // nudged to reference these only when natural — not to recite them.
    if (socialEvents.length > 0) {
      const socialLines = socialEvents
        .map((e) => {
          const delta = Math.max(
            0,
            inGameDay - inGameDayForTimestamp(e.in_game_timestamp),
          );
          const when =
            delta === 0 ? "Today" : delta === 1 ? "Yesterday" : `${delta} days ago`;
          const where = e.location ? ` at ${e.location}` : "";
          return `- ${when}${where}, ${e.content}`;
        })
        .join("\n");
      system +=
        `\n\nRECENT SOCIAL CONTEXT (things that have happened to you in the past few in-game days, may or may not be relevant to mention):\n` +
        socialLines +
        `\n\nYou can reference these naturally if relevant to the conversation, but don't shoehorn them in. Real people don't recite their week to anyone who asks.`;
    }

    // Relationship state: translate the start-of-turn scores into behavioral
    // guidance. Normally always present (defaults to 0.5s for a new pair).
    // Baseline mode does NOT inject relationship state — but currentScores is
    // still fetched above (and returned to the caller), and end-of-conversation
    // judging still runs, so the stateful behavior is recoverable for A/B.
    if (!baselineMode) {
      system += `\n\n${buildRelationshipGuidance(currentScores)}`;
    }

    // In-game time context. Each message in history is also prefixed with its
    // [Day X] below so the model can place prior turns in in-game time and
    // avoid real-world phrasings like "an hour ago".
    system +=
      `\n\nIN-GAME TIME\n` +
      `Today is in-game Day ${inGameDay} (Week ${weekOfQuarter(inGameDay)} of Fall Quarter). ` +
      `Each prior turn in the conversation below is tagged with the in-game day it happened on. ` +
      `When referring to past events, count in in-game days — use "today", "yesterday", "<N> days ago", or "earlier in the quarter". ` +
      `Do not invoke real-world time like "an hour ago" or "last week".`;

    // Final format reminder — non-negotiable, repeated at the end of system
    // so it's the freshest instruction before generation. The model otherwise
    // drifts into roleplay actions and long monologues even when the identity
    // prompt forbids them.
    system +=
      `\n\nFINAL FORMAT REMINDER — non-negotiable. If your reply violates any of these, it is wrong:\n` +
      `- LENGTH: 1–3 sentences. Up to 5 only if the moment really calls for it. NEVER more than 5. If you find yourself starting a 6th sentence, stop. Match the player's message length — short in, short out.\n` +
      `- Do NOT structure your reply as multiple paragraphs. Do NOT bullet point. Do NOT enumerate options A/B. Just talk.\n` +
      `- NO asterisks. NO action descriptions like *leans forward* / *pauses* / *sighs* / *nods*. NO stage directions of any kind. Dialogue only.\n` +
      `- NO bracketed metadata like [Day N] anywhere in your reply.\n` +
      `- Stay in your specific voice. Do NOT drift into generic empathetic-mentor / therapist voice even when the player is vulnerable.`;

    // Tag each historical message with the in-game day it happened on (when
    // available); the new player message gets today's day. Skip the prefix if
    // the content already starts with one (legacy NPC replies that leaked the
    // format before output sanitization landed).
    const tag = (content: string, day: number | null | undefined) => {
      if (day == null) return content;
      if (/^\[Day \d+\]/.test(content)) return content;
      return `[Day ${day}] ${content}`;
    };

    const messages: Anthropic.MessageParam[] = [
      ...orderedHistory.map((m) => ({
        role: toAnthropicRole(m.role as DbRole),
        content: tag(m.content as string, m.in_game_day as number | null),
      })),
      { role: "user" as const, content: tag(message, inGameDay) },
    ];

    // 5. Call Claude Haiku 4.5.
    const completion = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system,
      messages,
    });

    const rawReply = completion.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    // Sanitize: strip leading "[Day N]" prefixes the model mimicked from our
    // input-side tagging, and strip RP-style *action* annotations that slip
    // past the format instructions. Defense in depth.
    const reply = rawReply
      .replace(/^(\[Day \d+\]\s*)+/i, "")
      .replace(/\*[^*\n]+\*/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
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
      .insert({
        conversation_id,
        role: "player",
        content: message,
        in_game_day: inGameDay,
      });

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
      in_game_day: inGameDay,
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
      inGameTimestamp: nowInGame,
    }).catch((err) => {
      console.error("summarizeConversationAsMemory failed:", err);
    });

    // (Relationship judging used to run here per-turn. Moved to the explicit
    // /api/conversation/end endpoint so the judge sees the full conversation
    // and we don't pay a Sonnet call after every message. The per-turn fetch
    // of `currentScores` above is preserved for display in the API response.)

    // 8. Respond, including retrieved-memory metadata for the UI.
    const memoriesUsed = memories.map((m) => ({
      content: m.content,
      importance: m.importance,
      similarity: Number(m.similarity.toFixed(4)),
      recency: Number(m.recency.toFixed(4)),
      compositeScore: Number(m.compositeScore.toFixed(4)),
      daysAgo: daysAgo(m.createdAt),
    }));

    return NextResponse.json(
      {
        // `response` per spec; `reply` kept for backward compat with the
        // existing ChatClient (which reads `data.reply`).
        response: reply,
        reply,
        memoriesUsed,
        relationshipScores: currentScores,
        // The in-game day the server stamped this turn's messages with — the
        // client uses it to stamp the just-appended pair for cross-conversation
        // divider rendering.
        inGameDay,
        // Which mode produced this reply, so eval runs can label A/B output. In
        // baseline, memoriesUsed is [] and no relationship/social context was
        // injected, regardless of what state exists in the DB.
        baselineMode,
        usage: {
          input_tokens: completion.usage.input_tokens,
          output_tokens: completion.usage.output_tokens,
        },
      },
      { headers: { [EVAL_MODE_HEADER]: baselineMode ? "baseline" : "full" } },
    );
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Chat failed: ${messageText}` },
      { status: 500 },
    );
  }
}
