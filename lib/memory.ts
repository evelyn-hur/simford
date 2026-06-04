import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";
import { generateEmbedding } from "@/lib/embeddings";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { ChatMessage } from "@/lib/conversations";
import {
  buildKeywordMatchers,
  computeIdentityRelevance,
} from "@/lib/identityRelevance";

const MODEL = "claude-haiku-4-5-20251001";
// Consolidation is a deeper reasoning task, so it uses Sonnet.
const CONSOLIDATION_MODEL = "claude-sonnet-4-6";
const MIN_EPISODIC_FOR_CONSOLIDATION = 5;

// SQL composite weights for match_memories. Chosen via scripts/eval-retrieval.ts
// (imp-heavy default): surfaces meaningful + semantic rows on broad
// introspective queries, while staying sharp on topical ones. Recency stays
// modest so trivial-today doesn't drown relevant-older.
const RETRIEVAL_W_SIMILARITY_DEFAULT = 1.0;
const RETRIEVAL_W_IMPORTANCE_DEFAULT = 1.5;
const RETRIEVAL_W_RECENCY_DEFAULT = 0.7;

// Identity-relevance re-ranking (done in TS on the candidate set).
const IDENTITY_WEIGHT_DEFAULT = 0.3; // lower than the SQL composite's terms
const MIN_CANDIDATE_POOL = 15; // fetch a wider pool from SQL, then re-rank

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
  /** Identity-relevance term (0-1), computed in TS post-DB. */
  identityRelevance: number;
  /** Final composite, including the identity term (re-ranked in TS). */
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
  /**
   * Override the importance (1–10) instead of scoring it with the LLM. Used
   * when the caller already knows the salience (e.g. released inter-NPC events
   * derive importance from their relationship-delta magnitude).
   */
  importance?: number;
}

/**
 * Embed `content`, score its importance, and insert it into `memory_stream`.
 * Returns the new memory row's id. Shared by episodic writes and consolidation.
 */
async function writeMemory({
  npcId,
  memoryType,
  content,
  sourceConversationId = null,
  inGameTimestamp = null,
  importance: importanceOverride,
}: {
  npcId: string;
  memoryType: Memory["memoryType"];
  content: string;
  sourceConversationId?: string | null;
  inGameTimestamp?: string | null;
  importance?: number;
}): Promise<string> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("writeMemory: content is empty");
  }

  // Embed always; only score importance with the LLM when no override is given.
  const [embedding, importance] = await Promise.all([
    generateEmbedding(trimmed),
    importanceOverride != null
      ? Promise.resolve(Math.min(10, Math.max(1, Math.round(importanceOverride))))
      : scoreImportance(trimmed),
  ]);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("memory_stream")
    .insert({
      npc_id: npcId,
      memory_type: memoryType,
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
      `Failed to write ${memoryType} memory: ${error?.message ?? "unknown error"}`,
    );
  }

  return data.id as string;
}

/**
 * Embed `content`, score its importance, and insert it as an episodic memory.
 * Returns the new memory row's id.
 */
export async function writeEpisodicMemory({
  npcId,
  content,
  sourceConversationId = null,
  inGameTimestamp = null,
  importance,
}: WriteEpisodicMemoryParams): Promise<string> {
  return writeMemory({
    npcId,
    memoryType: "episodic",
    content,
    sourceConversationId,
    inGameTimestamp,
    importance,
  });
}

export interface SummarizeConversationParams {
  npcId: string;
  messages: ChatMessage[];
  conversationId: string;
  /** In-game timestamp for the memories written this turn. */
  inGameTimestamp?: string | null;
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
  inGameTimestamp = null,
}: SummarizeConversationParams): Promise<string[]> {
  if (messages.length === 0) return [];

  const transcript = messages
    .map((m) => `${m.role === "player" ? "Player" : "You"}: ${m.content}`)
    .join("\n");

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system:
      "You are a character reflecting on a conversation you just had with the player. Write 1-3 short, standalone memories of CONCRETE, SPECIFIC things about the player worth remembering — what they told you, want, did, or revealed. Each memory must name the actual specifics and begin with \"The player\" so it is unambiguous later who it is about — e.g. \"The player wants to pursue music production instead of becoming a lawyer, and feels guilty about disappointing their immigrant parents.\" Capture the concrete content, not vague psychological interpretation. Each memory on its own line. No numbering, no bullets, no preamble.",
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
        inGameTimestamp,
      }),
    ),
  );
}

export interface RetrieveMemoriesParams {
  npcId: string;
  /** Current player message plus brief recent context. */
  queryText: string;
  topK?: number;
  /** Current in-game timestamp; recency decays relative to this. */
  nowInGame?: string;
  /** NPC's identity keywords for post-DB identity-relevance re-ranking. */
  identityKeywords?: string[];
  /** Weight of the identity-relevance term (default 0.3). */
  identityWeight?: number;
  /** SQL composite weight on similarity (default 1.0). */
  wSimilarity?: number;
  /** SQL composite weight on importance (default 1.5 — imp-heavy). */
  wImportance?: number;
  /** SQL composite weight on recency (default 0.7). */
  wRecency?: number;
}

/**
 * Smallville-style retrieval: embed the query, rank this NPC's memories by a
 * composite of semantic similarity, importance, and recency (in SQL via
 * match_memories), then re-rank a wider candidate pool in TS by adding a 4th
 * identity-relevance term. Returns the top K by the re-ranked composite, with
 * component scores for debugging.
 */
export async function retrieveMemories({
  npcId,
  queryText,
  topK = 5,
  nowInGame,
  identityKeywords = [],
  identityWeight = IDENTITY_WEIGHT_DEFAULT,
  wSimilarity = RETRIEVAL_W_SIMILARITY_DEFAULT,
  wImportance = RETRIEVAL_W_IMPORTANCE_DEFAULT,
  wRecency = RETRIEVAL_W_RECENCY_DEFAULT,
}: RetrieveMemoriesParams): Promise<Memory[]> {
  const queryEmbedding = await generateEmbedding(queryText);

  // Pull a wider candidate set than topK so the TS re-rank can promote
  // identity-relevant memories that sat just outside the SQL top-K.
  const candidatePool = Math.max(topK * 3, MIN_CANDIDATE_POOL);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("match_memories", {
    p_npc_id: npcId,
    p_query_embedding: queryEmbedding,
    p_top_k: candidatePool,
    p_w_similarity: wSimilarity,
    p_w_importance: wImportance,
    p_w_recency: wRecency,
    // Recency decays over in-game time; omit to fall back to SQL default now().
    ...(nowInGame ? { p_now_in_game: nowInGame } : {}),
  });

  if (error) {
    throw new Error(`retrieveMemories failed: ${error.message}`);
  }

  const keywordMatchers = buildKeywordMatchers(identityKeywords);

  const memories: Memory[] = ((data ?? []) as MatchMemoriesRow[]).map((row) => {
    const identityRelevance = computeIdentityRelevance(
      row.content,
      keywordMatchers,
    );
    return {
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
      identityRelevance,
      // Re-ranked composite = SQL composite + identity term.
      compositeScore: row.composite_score + identityWeight * identityRelevance,
    };
  });

  memories.sort((a, b) => b.compositeScore - a.compositeScore);
  return memories.slice(0, topK);
}

export interface ConsolidateMemoriesParams {
  npcId: string;
  /** In-game timestamp for the semantic memories written. */
  nowInGame?: string | null;
}

/**
 * End-of-day reflection: fold this NPC's unconsolidated episodic memories
 * (everything since the last consolidation) into 1-3 higher-level SEMANTIC
 * memories, written in the NPC's own voice — patterns and takeaways, not literal
 * events. Skips if there are fewer than 5 episodics (not enough material).
 * Source episodics are marked consolidated (kept, not deleted). Returns the new
 * semantic memory ids.
 */
export async function consolidateMemoriesForNPC({
  npcId,
  nowInGame = null,
}: ConsolidateMemoriesParams): Promise<string[]> {
  const supabase = createServiceRoleClient();

  // Unconsolidated episodics = everything since the last consolidation.
  const { data: episodics, error } = await supabase
    .from("memory_stream")
    .select("id, content")
    .eq("npc_id", npcId)
    .eq("memory_type", "episodic")
    .is("consolidated_at", null)
    // Player-derived memories only. Inter-NPC event memories are written with a
    // null source_conversation_id (see lib/events.ts); folding them into
    // "observations about the player" leaks other NPCs' details (e.g. an
    // off-screen event where Alex was grinding the MCAT) into the player's
    // semantic memories. Exclude them so reflection stays about the player.
    .not("source_conversation_id", "is", null)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`consolidateMemoriesForNPC: fetch failed: ${error.message}`);
  }

  const sources = episodics ?? [];
  if (sources.length < MIN_EPISODIC_FOR_CONSOLIDATION) {
    return []; // not enough material to reflect on
  }

  // The NPC's identity is the system prompt so the reflection is in-voice.
  const { data: npc } = await supabase
    .from("npcs")
    .select("name, identity_prompt")
    .eq("id", npcId)
    .single();
  if (!npc) {
    throw new Error(`consolidateMemoriesForNPC: NPC '${npcId}' not found`);
  }

  const observations = sources.map((m) => `- ${m.content}`).join("\n");

  const reflection = await anthropic.messages.create({
    model: CONSOLIDATION_MODEL,
    max_tokens: 400,
    system: npc.identity_prompt as string,
    messages: [
      {
        role: "user",
        content: `These are your recent observations about the player:\n\n${observations}\n\nReflect on them as ${npc.name}. What deeper patterns or takeaways do you notice about this person? Write 1-3 short, higher-level insights — not a list of events, but what you've come to understand. GROUND each insight in the concrete specifics they told you (name the actual facts, not just abstractions), and refer to them as "the player" so it stays clear who each insight is about. Each insight on its own line. No numbering, no bullets, no preamble.`,
      },
    ],
  });

  const insights = extractText(reflection)
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 3);

  if (insights.length === 0) return [];

  // Write semantic memories first...
  const semanticIds = await Promise.all(
    insights.map((insight) =>
      writeMemory({
        npcId,
        memoryType: "semantic",
        content: insight,
        inGameTimestamp: nowInGame,
      }),
    ),
  );

  // ...then mark the sources consolidated. If this fails, the semantics still
  // exist; we log rather than throw (next run would just reprocess).
  const { error: markError } = await supabase
    .from("memory_stream")
    .update({ consolidated_at: new Date().toISOString() })
    .in(
      "id",
      sources.map((m) => m.id),
    );

  if (markError) {
    console.error(
      `consolidateMemoriesForNPC: wrote ${semanticIds.length} semantic ` +
        `memories but failed to mark sources consolidated (npc=${npcId}): ` +
        markError.message,
    );
  }

  return semanticIds;
}
