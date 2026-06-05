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

// Composite is roughly 0–3 (three components, each ~0–1). Map to an accent tint
// on the left edge so higher-scored memories read as "louder".
function accentStyle(composite: number): React.CSSProperties {
  const intensity = Math.min(1, Math.max(0, composite / 3));
  return {
    borderLeft: `4px solid rgba(140, 21, 21, ${(0.25 + 0.65 * intensity).toFixed(3)})`,
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
    <div
      style={{
        background: "var(--panel)",
        border: "2px solid var(--line-2)",
        borderRadius: "var(--r)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      {/* Header / collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          className="px"
          style={{ fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--ink-2)" }}
        >
          {firstName} is recalling…
        </span>
        <span style={{ color: "var(--ink-3)" }}>{collapsed ? "+" : "−"}</span>
      </button>

      {!collapsed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 12px 12px" }}>
          {memories.length === 0 && (
            <p style={{ textAlign: "center", fontSize: 12, color: "var(--ink-3)", padding: "18px 4px", fontStyle: "italic" }}>
              No memories recalled yet — they&apos;ll appear here as the conversation builds.
            </p>
          )}

          {memories.map((m, i) => (
            <div
              key={i}
              style={{
                ...accentStyle(m.compositeScore),
                background: "var(--panel-2)",
                border: "1px solid var(--line)",
                borderRadius: "4px 10px 10px 4px",
                padding: "9px 12px",
              }}
            >
              <p style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink)" }} title={m.content}>
                {truncate(m.content)}
              </p>
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "4px 10px",
                  fontSize: 11,
                  color: "var(--ink-3)",
                }}
              >
                <span
                  className="px"
                  style={{
                    fontSize: 10,
                    padding: "1px 7px",
                    borderRadius: 6,
                    background: "var(--accent-soft)",
                    color: "var(--accent-2)",
                  }}
                >
                  importance {m.importance}/10
                </span>
                <span>{agoLabel(m.daysAgo)}</span>
                <span className="tnum">sim {m.similarity.toFixed(2)}</span>
              </div>

              {showDebug && (
                <div
                  className="tnum"
                  style={{
                    marginTop: 6,
                    borderTop: "1px solid var(--line)",
                    paddingTop: 6,
                    fontFamily: "monospace",
                    fontSize: 10,
                    color: "var(--ink-3)",
                  }}
                >
                  similarity={m.similarity.toFixed(4)} · recency={m.recency.toFixed(4)} · composite=
                  {m.compositeScore.toFixed(4)}
                </div>
              )}
            </div>
          ))}

          {memories.length > 0 && (
            <button
              onClick={() => setShowDebug((d) => !d)}
              className="px"
              style={{
                marginTop: 2,
                width: "100%",
                padding: "6px 0",
                fontSize: 11,
                color: "var(--ink-3)",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              {showDebug ? "Hide debug info" : "Show debug info"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
