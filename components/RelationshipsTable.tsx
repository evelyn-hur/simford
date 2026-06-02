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
  return { backgroundColor: `rgba(140, 21, 21, ${(value * 0.16).toFixed(3)})` };
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
    <div className="overflow-x-auto rounded-2xl border border-neutral-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50 text-left">
            {COLUMNS.map((col) => {
              const active = col.key === sortKey;
              return (
                <th
                  key={col.key}
                  className={`whitespace-nowrap px-3 py-2 font-medium ${
                    col.key === "pair" ? "" : "text-right"
                  } ${
                    col.group === "derived"
                      ? "text-cardinal/80"
                      : "text-neutral-500"
                  }`}
                >
                  <button
                    onClick={() => onSort(col.key)}
                    className={`inline-flex items-center gap-1 transition hover:text-neutral-900 ${
                      active ? "text-neutral-900" : ""
                    }`}
                  >
                    {col.label}
                    <span className="text-[10px] text-neutral-400">
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
            <tr
              key={`${r.a}-${r.b}`}
              className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60"
            >
              <td className="whitespace-nowrap px-3 py-1.5 font-medium text-neutral-800">
                {r.a} <span className="text-neutral-300">·</span> {r.b}
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
                  className={`px-3 py-1.5 text-right tabular-nums ${
                    key === sortKey ? "font-semibold text-neutral-900" : "text-neutral-600"
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
