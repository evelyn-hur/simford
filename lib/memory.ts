import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";
import { generateEmbedding } from "@/lib/embeddings";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { ChatMessage } from "@/lib/conversations";

const MODEL = "claude-haiku-4-5-20251001";

export interface Memory {
  id: string;
  npcId: string;
  memoryType: "episodic" | "semantic" | "reflection";
  content: string;
  importance: number;
  sourceConversationId: string | null;
  inGameTimestamp: string | null;
  createdAt: string;
  // Component scores returned for debugging/inspection.
  similarity: number;
  importanceNorm: number;
  recency: number;
  compositeScore: number;
}

// Shape of a row returned by the match_memories SQL function.
interface MatchMemoriesRow {
  id: string;
  npc_id: string;
  memory_type: Memory["memoryType"];
  content: string;
  importance: number;
  source_conversation_id: string | null;
  in_game_timestamp: string | null;
  created_at: string;
  similarity: number;
  importance_norm: number;
  recency: number;
  composite_score: number;
}

// Used if the model returns something we can't parse a 1-10 score from.
const FALLBACK_IMPORTANCE = 5;

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter(
      (block): block is Anthropic.TextBlock => block.type === "text",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Ask Claude to rate how important a memory is for the character to retain.
 * Returns an integer clamped to [1, 10]; falls back to a mid score if the
 * response can't be parsed (importance scoring should never block a write).
 */
async function scoreImportance(content: string): Promise<number> {
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8,
      messages: [
        {
          role: "user",
          content: `Memory: "${content}"\n\nOn a scale of 1-10, how important is this memory for the character to remember? 1 = trivial small talk, 10 = major life-changing disclosure. Respond with ONLY the number.`,
        },
      ],
    });

    const match = extractText(message).match(/\d+/);
    if (!match) return FALLBACK_IMPORTANCE;

    const score = parseInt(match[0], 10);
    if (Number.isNaN(score)) return FALLBACK_IMPORTANCE;

    return Math.min(10, Math.max(1, score));
  } catch {
    return FALLBACK_IMPORTANCE;
  }
}

export interface WriteEpisodicMemoryParams {
  npcId: string;
  content: string;
  sourceConversationId?: string | null;
  /** ISO timestamptz string for the in-game clock, or null. */
  inGameTimestamp?: string | null;
}

/**
 * Embed `content`, score its importance, and insert it into `memory_stream`
 * as an episodic memory. Returns the new memory row's id.
 */
export async function writeEpisodicMemory({
  npcId,
  content,
  sourceConversationId = null,
  inGameTimestamp = null,
}: WriteEpisodicMemoryParams): Promise<string> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("writeEpisodicMemory: content is empty");
  }

  const [embedding, importance] = await Promise.all([
    generateEmbedding(trimmed),
    scoreImportance(trimmed),
  ]);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("memory_stream")
    .insert({
      npc_id: npcId,
      memory_type: "episodic",
      content: trimmed,
      importance,
      embedding,
      source_conversation_id: sourceConversationId,
      in_game_timestamp: inGameTimestamp,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to write episodic memory: ${error?.message ?? "unknown error"}`,
    );
  }

  return data.id as string;
}

export interface SummarizeConversationParams {
  npcId: string;
  messages: ChatMessage[];
  conversationId: string;
}

/**
 * Summarize a slice of conversation from the character's perspective into
 * 1-3 short standalone observations, then persist each as its own episodic
 * memory. Called after a conversation turn.
 *
 * Returns the ids of the memories written (may be empty if nothing notable).
 */
export async function summarizeConversationAsMemory({
  npcId,
  messages,
  conversationId,
}: SummarizeConversationParams): Promise<string[]> {
  if (messages.length === 0) return [];

  const transcript = messages
    .map((m) => `${m.role === "player" ? "Player" : "You"}: ${m.content}`)
    .join("\n");

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system:
      "You are a character reflecting on a conversation you just had with the player. Summarize what happened from YOUR perspective as 1-3 short, standalone observations you would want to remember about the player — not a transcript. Focus on what the player revealed, wants, or feels. Each observation on its own line. No numbering, no bullets, no preamble.",
    messages: [
      {
        role: "user",
        content: `Here is the conversation:\n\n${transcript}\n\nWrite 1-3 observations to remember.`,
      },
    ],
  });

  const observations = extractText(message)
    .split(/\r?\n/)
    // Strip any stray leading bullets/numbering the model adds anyway.
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 3);

  if (observations.length === 0) return [];

  return Promise.all(
    observations.map((observation) =>
      writeEpisodicMemory({
        npcId,
        content: observation,
        sourceConversationId: conversationId,
      }),
    ),
  );
}

export interface RetrieveMemoriesParams {
  npcId: string;
  /** Current player message plus brief recent context. */
  queryText: string;
  topK?: number;
}

/**
 * Smallville-style retrieval: embed the query, then rank this NPC's memories
 * by a composite of semantic similarity, stored importance, and recency
 * (computed in SQL via the match_memories function). Returns the top K,
 * highest composite score first, with the component scores for debugging.
 */
export async function retrieveMemories({
  npcId,
  queryText,
  topK = 5,
}: RetrieveMemoriesParams): Promise<Memory[]> {
  const queryEmbedding = await generateEmbedding(queryText);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("match_memories", {
    p_npc_id: npcId,
    p_query_embedding: queryEmbedding,
    p_top_k: topK,
  });

  if (error) {
    throw new Error(`retrieveMemories failed: ${error.message}`);
  }

  return ((data ?? []) as MatchMemoriesRow[]).map((row) => ({
    id: row.id,
    npcId: row.npc_id,
    memoryType: row.memory_type,
    content: row.content,
    importance: row.importance,
    sourceConversationId: row.source_conversation_id,
    inGameTimestamp: row.in_game_timestamp,
    createdAt: row.created_at,
    similarity: row.similarity,
    importanceNorm: row.importance_norm,
    recency: row.recency,
    compositeScore: row.composite_score,
  }));
}
