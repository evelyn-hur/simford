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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--panel-2)",
        border: "1.5px solid var(--line-2)",
        borderRadius: 20,
        padding: "4px 5px 4px 13px",
      }}
    >
      <span
        className="px tnum"
        style={{ fontSize: 11.5, color: "var(--ink-2)", whiteSpace: "nowrap" }}
      >
        {gameTimeLabel(day)}
      </span>
      <button
        onClick={advance}
        disabled={advancing}
        title="Advance the in-game day by 1"
        className="px"
        style={{
          fontSize: 11,
          padding: "5px 11px",
          borderRadius: 16,
          border: "2px solid var(--accent-2)",
          background: advancing ? "var(--ink-3)" : "var(--accent)",
          color: "var(--accent-ink)",
          cursor: advancing ? "default" : "pointer",
          whiteSpace: "nowrap",
          opacity: advancing ? 0.7 : 1,
        }}
      >
        {advancing ? "…" : "advance →"}
      </button>
    </div>
  );
}
