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
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">
          Top Cofounder Pairs
        </h2>
        <span className="text-[11px] text-neutral-400">respect-weighted</span>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-cardinal">Couldn’t load pairs: {error}</p>
      ) : loading || pairs === null ? (
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[88px] animate-pulse rounded-xl bg-neutral-100"
            />
          ))}
        </div>
      ) : pairs.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">No pairs yet.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {pairs.map((p, i) => {
            const active = samePair(p, selectedPair);
            return (
              <li key={`${p.a}-${p.b}`}>
                <button
                  onClick={() => onSelect(p)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    active
                      ? "border-cardinal/40 bg-cardinal/5"
                      : "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-neutral-900">
                      <span className="mr-1.5 text-xs text-neutral-400">
                        {i + 1}.
                      </span>
                      {p.aName}{" "}
                      <span className="text-neutral-300">↔</span> {p.bName}
                    </span>
                    <span className="shrink-0 text-lg font-semibold tabular-nums text-cardinal">
                      {pct(p.cofounder_score)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-neutral-500">
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
