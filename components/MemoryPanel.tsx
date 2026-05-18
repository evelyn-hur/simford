"use client";

import { useState } from "react";

export interface MemoryUsed {
  content: string;
  importance: number;
  similarity: number;
  recency: number;
  compositeScore: number;
  daysAgo: number;
}

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function agoLabel(daysAgo: number): string {
  if (daysAgo <= 0) return "today";
  if (daysAgo === 1) return "1 day ago";
  return `${daysAgo} days ago`;
}

// Composite is roughly 0–3 (three components, each ~0–1). Map to a cardinal
// tint so higher-scored memories read as "louder".
function accentStyle(composite: number): React.CSSProperties {
  const intensity = Math.min(1, Math.max(0, composite / 3));
  return {
    borderLeftWidth: 3,
    borderLeftColor: `rgba(140, 21, 21, ${(0.2 + 0.7 * intensity).toFixed(3)})`,
  };
}

export default function MemoryPanel({
  npcName,
  memories,
}: {
  npcName: string;
  memories: MemoryUsed[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const firstName = npcName.split(/\s+/)[0] || npcName;

  return (
    <aside className="shrink-0 lg:w-80">
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50">
        {/* Header / collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center justify-between rounded-t-2xl px-4 py-3 text-left"
          aria-expanded={!collapsed}
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {firstName} is recalling…
          </span>
          <span className="text-neutral-400">{collapsed ? "+" : "−"}</span>
        </button>

        {!collapsed && (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto px-3 pb-3 lg:max-h-none">
            {memories.length === 0 && (
              <p className="px-1 py-6 text-center text-xs text-neutral-400">
                No memories recalled yet — they&apos;ll appear here as the
                conversation builds.
              </p>
            )}

            {memories.map((m, i) => (
              <div
                key={i}
                style={accentStyle(m.compositeScore)}
                className="rounded-r-lg bg-white px-3 py-2 shadow-sm"
              >
                <p
                  className="text-xs leading-relaxed text-neutral-700"
                  title={m.content}
                >
                  {truncate(m.content)}
                </p>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                  <span className="rounded bg-cardinal/10 px-1.5 py-0.5 font-medium text-cardinal">
                    importance {m.importance}/10
                  </span>
                  <span>{agoLabel(m.daysAgo)}</span>
                  <span>sim {m.similarity.toFixed(2)}</span>
                </div>

                {showDebug && (
                  <div className="mt-1.5 border-t border-neutral-100 pt-1.5 font-mono text-[10px] text-neutral-400">
                    similarity={m.similarity.toFixed(4)} · recency=
                    {m.recency.toFixed(4)} · composite=
                    {m.compositeScore.toFixed(4)}
                  </div>
                )}
              </div>
            ))}

            {memories.length > 0 && (
              <button
                onClick={() => setShowDebug((d) => !d)}
                className="mt-1 w-full rounded-md py-1.5 text-[11px] text-neutral-400 transition hover:text-cardinal"
              >
                {showDebug ? "Hide debug info" : "Show debug info"}
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
