import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { writeEpisodicMemory } from "@/lib/memory";
import {
  applyNpcNpcRelationshipDeltas,
  type RelationshipDeltas,
} from "@/lib/relationships";
import { inGameTimestampForDay } from "@/lib/gameTime";

interface StoredDeltas {
  trust?: number;
  respect?: number;
  vibe?: number;
}

interface InterNpcEventRow {
  id: string;
  npc_a_id: string;
  npc_b_id: string;
  content: string;
  in_game_timestamp: string | null;
  relationship_deltas: StoredDeltas | null;
}

export interface ReleaseSummary {
  released: number;
  failed: number;
  pairs: { a: string; b: string }[];
}

/** Importance (1–10) from the magnitude of an event's relationship deltas. */
function importanceFromDeltas(d: StoredDeltas | null): number {
  const total =
    Math.abs(d?.trust ?? 0) + Math.abs(d?.respect ?? 0) + Math.abs(d?.vibe ?? 0);
  // Max total ≈ 0.15 (three ±0.05 deltas) → ~8; a neutral event → ~2. These are
  // low-salience background moments, so they sit below conversation memories.
  return Math.min(10, Math.max(1, Math.round(2 + (total / 0.15) * 6)));
}

/**
 * Release ("publish") the off-screen NPC↔NPC events that have occurred by the
 * given in-game day. For each unprocessed inter_npc_event with
 * in_game_timestamp ≤ that day, this:
 *   a. writes the event as an episodic memory to BOTH NPCs (so each "remembers"
 *      crossing paths), importance derived from the delta magnitude;
 *   b. applies the relationship deltas to npc_npc_relationships and logs a
 *      system relationship_event (player_id = NULL) linked to the event;
 *   c. marks the event processed.
 *
 * Catch-up semantics: it releases ALL unprocessed events up to `inGameDay`, so
 * the first advance clears any backlog and later advances release each new day.
 * Per-event errors are isolated — one bad event doesn't abort the batch.
 *
 * Concurrency caveat: `processed` is set AFTER the work, so the common failure
 * (an embedding error before any write) leaves the event cleanly retryable; the
 * rare case of two releases racing the same event could double-apply. Acceptable
 * at single-player scale — advancing the day is one deliberate action and this
 * runs fire-and-forget from /api/advance-day.
 *
 * `playerId` is currently informational (the NPC world is shared, not
 * per-player); kept in the signature for symmetry with the day-advance flow.
 */
export async function releaseEventsForDay(
  playerId: string,
  inGameDay: number,
): Promise<ReleaseSummary> {
  void playerId; // reserved for future per-player worlds
  const supabase = createServiceRoleClient();
  const nowInGame = inGameTimestampForDay(inGameDay);

  const { data: events, error } = await supabase
    .from("inter_npc_events")
    .select(
      "id, npc_a_id, npc_b_id, content, in_game_timestamp, relationship_deltas",
    )
    .eq("processed", false)
    .lte("in_game_timestamp", nowInGame)
    .order("in_game_timestamp", { ascending: true });

  if (error) {
    throw new Error(
      `releaseEventsForDay: failed to fetch events: ${error.message}`,
    );
  }

  const summary: ReleaseSummary = { released: 0, failed: 0, pairs: [] };

  for (const ev of (events ?? []) as InterNpcEventRow[]) {
    try {
      const deltas = ev.relationship_deltas ?? {};
      const importance = importanceFromDeltas(deltas);

      // a. Episodic memory to BOTH NPCs (embeddings handled inside).
      await Promise.all([
        writeEpisodicMemory({
          npcId: ev.npc_a_id,
          content: ev.content,
          inGameTimestamp: ev.in_game_timestamp,
          importance,
        }),
        writeEpisodicMemory({
          npcId: ev.npc_b_id,
          content: ev.content,
          inGameTimestamp: ev.in_game_timestamp,
          importance,
        }),
      ]);

      // b. Apply deltas to the NPC↔NPC relationship + log the system event.
      //    Stored deltas use {trust,respect,vibe}; map to the delta_* contract.
      const relDeltas: RelationshipDeltas = {
        delta_trust: deltas.trust ?? 0,
        delta_respect: deltas.respect ?? 0,
        delta_vibe: deltas.vibe ?? 0,
        reasoning: "",
      };
      await applyNpcNpcRelationshipDeltas({
        npcAId: ev.npc_a_id,
        npcBId: ev.npc_b_id,
        deltas: relDeltas,
        interNpcEventId: ev.id,
      });

      // c. Mark processed last, so a mid-event failure leaves it retryable.
      const { error: markError } = await supabase
        .from("inter_npc_events")
        .update({ processed: true })
        .eq("id", ev.id);
      if (markError) {
        throw new Error(`failed to mark processed: ${markError.message}`);
      }

      summary.released += 1;
      summary.pairs.push({ a: ev.npc_a_id, b: ev.npc_b_id });
    } catch (err) {
      summary.failed += 1;
      console.error(
        `releaseEventsForDay: event ${ev.id} (${ev.npc_a_id}↔${ev.npc_b_id}) failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return summary;
}
