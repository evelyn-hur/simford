"use client";

export interface RecentChange {
  /** In-game day the off-screen event occurred, or null. */
  day: number | null;
  npcA: { id: string; name: string };
  npcB: { id: string; name: string };
  deltas: { trust: number; respect: number; vibe: number };
  content: string | null;
  location: string | null;
}

const DIMS: { key: "trust" | "respect" | "vibe"; label: string }[] = [
  { key: "trust", label: "trust" },
  { key: "respect", label: "respect" },
  { key: "vibe", label: "vibe" },
];

// toFixed keeps the minus sign for negatives; add an explicit plus otherwise.
const signed = (n: number) => (n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2));

/**
 * "Recent network changes" — the latest system-driven (NPC↔NPC) relationship
 * shifts released as the in-game day advances, with the inter-NPC event that
 * caused each one. Mirrors CofounderPanel's card styling.
 */
export default function RecentChangesPanel({
  changes,
  loading,
  error,
}: {
  changes: RecentChange[] | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">
          Recent Network Changes
        </h2>
        <span className="text-[11px] text-neutral-400">
          off-screen events between students
        </span>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-cardinal/5 px-3 py-2 text-sm text-cardinal">
          Failed to load changes: {error}
        </p>
      ) : loading ? (
        <p className="mt-3 text-sm text-neutral-400">Loading…</p>
      ) : !changes || changes.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-400">
          No off-screen events have been released yet — advance the in-game day
          to let the network evolve.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-neutral-100">
          {changes.map((c, i) => (
            <li key={i} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {c.day != null && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                    Day {c.day}
                  </span>
                )}
                <span className="text-sm font-medium text-neutral-800">
                  {c.npcA.name} <span className="text-neutral-400">→</span>{" "}
                  {c.npcB.name}
                </span>
                <span className="ml-auto flex flex-wrap gap-1">
                  {DIMS.map(({ key, label }) => {
                    const v = c.deltas[key];
                    if (!v) return null;
                    return (
                      <span
                        key={key}
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          v > 0
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {label} {signed(v)}
                      </span>
                    );
                  })}
                </span>
              </div>
              {c.content && (
                <p className="mt-1 text-sm leading-snug text-neutral-600">
                  “{c.content}”
                  {c.location && (
                    <span className="text-neutral-400"> — {c.location}</span>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
