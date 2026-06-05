import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { DEV_PLAYER_ID, DEV_PLAYER_NAME } from "@/lib/dev";
import { resetPlayer } from "@/lib/resetGame";

export const runtime = "nodejs";

/**
 * Restart the (single-player) game for the dev player. Wipes play state; the
 * seeded NPCs, their relationship priors (restored from the immutable snapshot,
 * not deleted), and the generated inter-NPC events are preserved. Triggered by
 * the in-app Restart button after a confirmation.
 */
export async function POST() {
  const supabase = createServiceRoleClient();
  try {
    // Ensure the dev player exists (FK target for the reset's upserts).
    const { error: playerErr } = await supabase
      .from("players")
      .upsert(
        { id: DEV_PLAYER_ID, display_name: DEV_PLAYER_NAME },
        { onConflict: "id" },
      );
    if (playerErr) throw new Error(`ensure player: ${playerErr.message}`);

    const summary = await resetPlayer(supabase, DEV_PLAYER_ID);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Restart failed: ${msg}` }, { status: 500 });
  }
}
