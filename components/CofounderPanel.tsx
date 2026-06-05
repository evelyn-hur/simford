"use client";

export interface CofounderPair {
  a: string;
  b: string;
  aName: string;
  bName: string;
  cofounder_score: number;
  trust: number;
  respect: number;
  vibe: number;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function samePair(
  p: CofounderPair,
  sel: { a: string; b: string } | null | undefined,
): boolean {
  if (!sel) return false;
  return (
    (sel.a === p.a && sel.b === p.b) || (sel.a === p.b && sel.b === p.a)
  );
}

export default function CofounderPanel({
  pairs,
  loading,
  error,
  selectedPair,
  onSelect,
}: {
  pairs: CofounderPair[] | null;
  loading: boolean;
  error: string | null;
  selectedPair?: { a: string; b: string } | null;
  onSelect: (pair: CofounderPair) => void;
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
          Top Cofounder Pairs
        </h2>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>respect-weighted</span>
      </div>

      {error ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--accent-2)" }}>Couldn&rsquo;t load pairs: {error}</p>
      ) : loading || pairs === null ? (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{ height: 88, borderRadius: 12, background: "var(--panel-3)" }}
            />
          ))}
        </div>
      ) : pairs.length === 0 ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--ink-2)" }}>No pairs yet.</p>
      ) : (
        <ol style={{ marginTop: 12, display: "grid", gap: 8, listStyle: "none", padding: 0 }}>
          {pairs.map((p, i) => {
            const active = samePair(p, selectedPair);
            return (
              <li key={`${p.a}-${p.b}`}>
                <button
                  onClick={() => onSelect(p)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    borderRadius: 12,
                    padding: 12,
                    cursor: "pointer",
                    border: "2px solid " + (active ? "var(--accent-2)" : "var(--line-2)"),
                    background: active ? "var(--accent-soft)" : "var(--panel-2)",
                    transition: "border-color .15s, background .15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ minWidth: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                      <span className="px" style={{ marginRight: 6, fontSize: 12, color: "var(--ink-3)" }}>
                        {i + 1}.
                      </span>
                      {p.aName} <span style={{ color: "var(--ink-3)" }}>↔</span> {p.bName}
                    </span>
                    <span className="px tnum" style={{ flexShrink: 0, fontSize: 18, color: "var(--accent)" }}>
                      {pct(p.cofounder_score)}
                    </span>
                  </div>
                  <div className="tnum" style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: "0 12px", fontSize: 11, color: "var(--ink-3)" }}>
                    <span>Trust {pct(p.trust)}</span>
                    <span>Respect {pct(p.respect)}</span>
                    <span>Vibe {pct(p.vibe)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
