/**
 * In-game time mapping. A memory's `in_game_timestamp` is computed as
 * QUARTER_START + in_game_day days, so recency can decay over in-game time
 * rather than real-world time.
 *
 * This is the single source of truth for the day→timestamp mapping; the
 * match_memories migration's legacy backfill uses the day-1 value below.
 */
const QUARTER_START_MS = Date.UTC(2025, 8, 22); // 2025-09-22 (month is 0-based)
const DAY_MS = 86_400_000;

/** ISO timestamp for a given in-game day (QUARTER_START + day days). */
export function inGameTimestampForDay(day: number): string {
  return new Date(QUARTER_START_MS + Math.max(1, day) * DAY_MS).toISOString();
}

/**
 * In-game day for a given in-game timestamp — the inverse of
 * inGameTimestampForDay (exact for the day ≥ 1 values we ever store).
 */
export function inGameDayForTimestamp(iso: string): number {
  return Math.round((new Date(iso).getTime() - QUARTER_START_MS) / DAY_MS);
}

/** Week number within the quarter (day 1–7 = week 1). */
export function weekOfQuarter(day: number): number {
  return Math.floor((Math.max(1, day) - 1) / 7) + 1;
}

/** Header label, e.g. "Week 4 of Fall Quarter · Day 25". */
export function gameTimeLabel(day: number): string {
  return `Week ${weekOfQuarter(day)} of Fall Quarter · Day ${day}`;
}
