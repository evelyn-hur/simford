import { PixelTree } from "@/components/pixel";
import NavTabs from "@/components/NavTabs";
import RestartButton from "@/components/RestartButton";
import { getInGameDay } from "@/lib/gameState";
import { weekOfQuarter } from "@/lib/gameTime";
import { DEV_PLAYER_ID } from "@/lib/dev";

/**
 * Top bar: pixel redwood logo + wordmark, nav tabs, and a read-only day pill.
 * Async so the pill reflects the live in-game day; falls back to Day 1 if the
 * game-state read fails so a transient DB error never blanks every page.
 */
export default async function Header() {
  let day = 1;
  try {
    day = await getInGameDay(DEV_PLAYER_ID);
  } catch {
    /* keep fallback day */
  }

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "var(--bg)",
        borderBottom: "2px solid var(--line-2)",
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "11px 22px",
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        <a
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            textDecoration: "none",
            color: "var(--ink)",
          }}
        >
          <PixelTree scale={2} />
          <span className="px" style={{ fontSize: 21 }}>
            Simford
          </span>
        </a>

        <NavTabs />

        <div
          className="px"
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: "var(--panel-2)",
            border: "1.5px solid var(--line)",
            borderRadius: 20,
            padding: "5px 13px",
            fontSize: 11.5,
            color: "var(--ink-2)",
          }}
        >
          <span aria-hidden="true">☀️</span>
          <span className="tnum">
            Week {weekOfQuarter(day)} · Day {day}
          </span>
        </div>

        <RestartButton />
      </div>
    </header>
  );
}
