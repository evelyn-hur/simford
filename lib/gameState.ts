import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Current in-game day for a player, creating the game_state row at day 1 if
 * it doesn't exist yet.
 */
export async function getInGameDay(playerId: string): Promise<number> {
  const supabase = createServiceRoleClient();

  const { data } = await supabase
    .from("game_state")
    .select("in_game_day")
    .eq("player_id", playerId)
    .maybeSingle();

  if (data) return data.in_game_day as number;

  const { error } = await supabase
    .from("game_state")
    .insert({ player_id: playerId, in_game_day: 1 });

  if (error) {
    // Likely a concurrent insert — re-read.
    const { data: again } = await supabase
      .from("game_state")
      .select("in_game_day")
      .eq("player_id", playerId)
      .maybeSingle();
    return (again?.in_game_day as number) ?? 1;
  }

  return 1;
}

/** Advance the player's in-game day by 1 and return the new value. */
export async function advanceInGameDay(playerId: string): Promise<number> {
  const supabase = createServiceRoleClient();

  const { data } = await supabase
    .from("game_state")
    .select("in_game_day")
    .eq("player_id", playerId)
    .maybeSingle();

  const next = ((data?.in_game_day as number) ?? 1) + 1;

  const { error } = await supabase.from("game_state").upsert(
    {
      player_id: playerId,
      in_game_day: next,
      last_advanced_at: new Date().toISOString(),
    },
    { onConflict: "player_id" },
  );

  if (error) throw new Error(`Failed to advance in-game day: ${error.message}`);
  return next;
}
