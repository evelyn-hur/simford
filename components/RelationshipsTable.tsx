"use client";

import { useState } from "react";

export interface PairRow {
  a: string;
  b: string;
  trust: number;
  respect: number;
  vibe: number;
  affinity: number;
  cofounder: number;
  close_friend: number;
  study_partner: number;
  frenemy: number;
}

type SortKey = keyof Omit<PairRow, "a" | "b"> | "pair";

const COLUMNS: { key: SortKey; label: string; group?: "primitive" | "derived" }[] =
  [
    { key: "pair", label: "Pair" },
    { key: "trust", label: "Trust", group: "primitive" },
    { key: "respect", label: "Respect", group: "primitive" },
    { key: "vibe", label: "Vibe", group: "primitive" },
    { key: "affinity", label: "Affinity", group: "primitive" },
    { key: "cofounder", label: "Cofounder", group: "derived" },
    { key: "close_friend", label: "Close friend", group: "derived" },
    { key: "study_partner", label: "Study partner", group: "derived" },
    { key: "frenemy", label: "Frenemy", group: "derived" },
  ];

// Faint cardinal heat so high values pop when scanning the table.
function cellStyle(value: number): React.CSSProperties {
  return { backgroundColor: `rgba(140, 21, 21, ${(value * 0.18).toFixed(3)})` };
}

export default function RelationshipsTable({ rows }: { rows: PairRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("cofounder");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const sorted = [...rows].sort((x, y) => {
    const cmp =
      sortKey === "pair"
        ? `${x.a} ${x.b}`.localeCompare(`${y.a} ${y.b}`)
        : (x[sortKey] as number) - (y[sortKey] as number);
    return dir === "asc" ? cmp : -cmp;
  });

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir(key === "pair" ? "asc" : "desc");
    }
  }

  return (
    <div className="overflow-x-auto rounded-card border-2 border-line-2 bg-panel shadow-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-line bg-panel-2 text-left">
            {COLUMNS.map((col) => {
              const active = col.key === sortKey;
              return (
                <th
                  key={col.key}
                  className={`whitespace-nowrap px-3 py-2.5 ${col.key === "pair" ? "" : "text-right"}`}
                >
                  <button
                    onClick={() => onSort(col.key)}
                    className={`px inline-flex items-center gap-1 text-[11px] uppercase tracking-wide transition ${
                      active
                        ? "!text-ink"
                        : col.group === "derived"
                          ? "text-accent"
                          : "text-ink-3"
                    }`}
                  >
                    {col.label}
                    <span className="text-[9px] text-ink-3">
                      {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={`${r.a}-${r.b}`} className="border-b border-line last:border-0 hover:bg-panel-2">
              <td className="whitespace-nowrap px-3 py-2 font-semibold text-ink">
                {r.a} <span className="text-ink-3">·</span> {r.b}
              </td>
              {(
                [
                  "trust",
                  "respect",
                  "vibe",
                  "affinity",
                  "cofounder",
                  "close_friend",
                  "study_partner",
                  "frenemy",
                ] as const
              ).map((key) => (
                <td
                  key={key}
                  style={cellStyle(r[key])}
                  className={`tnum px-3 py-2 text-right ${
                    key === sortKey ? "font-bold text-ink" : "text-ink-2"
                  }`}
                >
                  {r[key].toFixed(2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
