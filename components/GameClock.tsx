"use client";

import { useState } from "react";
import { gameTimeLabel } from "@/lib/gameTime";

export default function GameClock({
  initialDay,
  conversationId,
}: {
  initialDay: number;
  conversationId: string;
}) {
  const [day, setDay] = useState(initialDay);
  const [advancing, setAdvancing] = useState(false);

  async function advance() {
    if (advancing) return;
    setAdvancing(true);
    try {
      const res = await fetch("/api/advance-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const data = (await res.json()) as { in_game_day?: number };
      if (data.in_game_day) setDay(data.in_game_day);
      // Advance ends any open conversations server-side. The current page's
      // conversationId is now judged, so subsequent messages would orphan
      // themselves. Reload so getOrCreateConversation mints a fresh row and
      // the thread renders the day boundary as an iMessage-style divider.
      window.location.reload();
    } finally {
      setAdvancing(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 py-1 pl-3 pr-1 text-xs text-neutral-600">
      <span className="whitespace-nowrap">{gameTimeLabel(day)}</span>
      <button
        onClick={advance}
        disabled={advancing}
        title="Advance the in-game day by 1"
        className="rounded-full bg-cardinal px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-cardinal/90 disabled:opacity-50"
      >
        {advancing ? "…" : "advance →"}
      </button>
    </div>
  );
}
