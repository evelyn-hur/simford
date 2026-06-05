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
    <section
      style={{
        background: "var(--panel)",
        border: "2px solid var(--line-2)",
        borderRadius: "var(--r)",
        boxShadow: "var(--shadow-card)",
        padding: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2 className="px" style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1, margin: 0, color: "var(--ink)" }}>
          Recent Network Changes
        </h2>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>off-screen events between students</span>
      </div>

      {error ? (
        <p style={{ marginTop: 12, background: "var(--accent-soft)", color: "var(--accent-2)", borderRadius: 10, padding: "8px 12px", fontSize: 13 }}>
          Failed to load changes: {error}
        </p>
      ) : loading ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--ink-3)" }}>Loading…</p>
      ) : !changes || changes.length === 0 ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--ink-3)" }}>
          No off-screen events have been released yet — advance the in-game day to let the network evolve.
        </p>
      ) : (
        <ul style={{ marginTop: 12, listStyle: "none", padding: 0 }}>
          {changes.map((c, i) => (
            <li key={i} style={{ padding: "10px 0", borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 8px" }}>
                {c.day != null && (
                  <span
                    className="px"
                    style={{ borderRadius: 20, background: "rgba(124,58,237,.14)", color: "#7c3aed", padding: "2px 9px", fontSize: 11 }}
                  >
                    Day {c.day}
                  </span>
                )}
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                  {c.npcA.name} <span style={{ color: "var(--ink-3)" }}>→</span> {c.npcB.name}
                </span>
                <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {DIMS.map(({ key, label }) => {
                    const v = c.deltas[key];
                    if (!v) return null;
                    return (
                      <span
                        key={key}
                        className="tnum"
                        style={{
                          borderRadius: 6,
                          padding: "1px 7px",
                          fontSize: 11,
                          fontWeight: 600,
                          background: v > 0 ? "rgba(79,148,102,.16)" : "rgba(177,74,60,.16)",
                          color: v > 0 ? "var(--good)" : "var(--bad)",
                        }}
                      >
                        {label} {signed(v)}
                      </span>
                    );
                  })}
                </span>
              </div>
              {c.content && (
                <p style={{ marginTop: 5, fontSize: 13.5, lineHeight: 1.45, color: "var(--ink-2)" }}>
                  &ldquo;{c.content}&rdquo;
                  {c.location && <span style={{ color: "var(--ink-3)" }}> — {c.location}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
