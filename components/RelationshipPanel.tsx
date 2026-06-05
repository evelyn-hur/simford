"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computeDerivedMetrics, rankDerivedMetrics } from "@/lib/relationshipMetrics";
import { Meter, BandTag } from "@/components/pixel";

export interface RelationshipScores {
  trust: number;
  respect: number;
  vibe: number;
}

interface RelEvent {
  delta_trust: number;
  delta_respect: number;
  delta_vibe: number;
  reasoning: string | null;
  created_at: string;
}

const DIMS = ["trust", "respect", "vibe"] as const;
type Dim = (typeof DIMS)[number];

function fmtDelta(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const cap = (d: Dim) => d[0].toUpperCase() + d.slice(1);

export default function RelationshipPanel({
  npcName,
  npcId,
  conversationId,
  scores,
  turnId,
  refreshKey,
}: {
  npcName: string;
  npcId: string;
  conversationId: string;
  scores: RelationshipScores;
  turnId: number;
  /**
   * Bumped by the parent after a "Say goodbye" judges the current conversation.
   * When it changes, the panel opens the history and refetches so the new
   * relationship event is visible. (The meters update via the `scores` prop.)
   */
  refreshKey?: number;
}) {
  // Highlight dimensions that changed since the previous turn.
  const [flash, setFlash] = useState<Record<Dim, boolean>>({
    trust: false,
    respect: false,
    vibe: false,
  });
  const prevScores = useRef<RelationshipScores>(scores);

  useEffect(() => {
    const prev = prevScores.current;
    const changed = {
      trust: prev.trust !== scores.trust,
      respect: prev.respect !== scores.respect,
      vibe: prev.vibe !== scores.vibe,
    };
    prevScores.current = scores;
    if (changed.trust || changed.respect || changed.vibe) {
      setFlash(changed);
      const t = setTimeout(
        () => setFlash({ trust: false, respect: false, vibe: false }),
        1300,
      );
      return () => clearTimeout(t);
    }
  }, [scores]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [events, setEvents] = useState<RelEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/relationship-events?npcId=${encodeURIComponent(
          npcId,
        )}&conversationId=${encodeURIComponent(conversationId)}`,
      );
      const data = (await res.json()) as { events?: RelEvent[] };
      setEvents(data.events ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [npcId, conversationId]);

  // After a "Say goodbye" (parent bumps refreshKey), open the history and
  // refetch so the freshly-written relationship event is visible. Skips the
  // initial render so it only reacts to real changes.
  const prevRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === prevRefreshKey.current) return;
    prevRefreshKey.current = refreshKey;
    setHistoryOpen(true);
    void loadHistory();
  }, [refreshKey, loadHistory]);

  // Fetch when first expanded.
  useEffect(() => {
    if (historyOpen && events === null) void loadHistory();
  }, [historyOpen, events, loadHistory]);

  // The relationship judge writes its event a few seconds after a turn
  // (background). If history is open, refetch shortly after each new turn.
  useEffect(() => {
    if (!historyOpen || turnId === 0) return;
    const t = setTimeout(() => void loadHistory(), 5000);
    return () => clearTimeout(t);
  }, [turnId, historyOpen, loadHistory]);

  // Derived "fun" labels, recomputed from the live scores; show the top 3.
  const topMetrics = rankDerivedMetrics(
    computeDerivedMetrics(scores.trust, scores.respect, scores.vibe),
  ).slice(0, 3);
  const firstName = npcName.split(/\s+/)[0] || npcName;

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "2px solid var(--line-2)",
        borderRadius: "var(--r)",
        boxShadow: "var(--shadow-card)",
        padding: 14,
      }}
    >
      <p
        className="px"
        style={{ fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--ink-2)", margin: "0 0 12px" }}
      >
        Relationship with {firstName}
      </p>

      {/* Meters */}
      <div style={{ display: "grid", gap: 11 }}>
        {DIMS.map((dim) => (
          <Meter key={dim} dim={dim} value={scores[dim]} big flash={flash[dim]} />
        ))}
      </div>

      {/* Derived "fun" metrics — top 3, recomputed from the live scores. */}
      <div style={{ marginTop: 14, background: "var(--accent-soft)", borderRadius: 12, padding: "10px 12px" }}>
        <p
          className="px"
          style={{ fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--ink-2)", margin: "0 0 7px" }}
        >
          What you could be
        </p>
        <div style={{ display: "grid", gap: 6 }}>
          {topMetrics.map((m) => (
            <div key={m.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--ink)" }}>{m.label}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span className="tnum" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                  {Math.round(m.score * 100)}
                </span>
                <BandTag b={m.band} />
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Relationship history */}
      <div style={{ marginTop: 14, borderTop: "2px solid var(--line)", paddingTop: 10 }}>
        <button
          onClick={() => setHistoryOpen((o) => !o)}
          aria-expanded={historyOpen}
          className="px"
          style={{
            display: "flex",
            width: "100%",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 11.5,
            color: "var(--ink-2)",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          <span>Relationship history</span>
          <span style={{ color: "var(--ink-3)" }}>{historyOpen ? "−" : "+"}</span>
        </button>

        {historyOpen && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={() => void loadHistory()}
              disabled={loading}
              style={{
                alignSelf: "flex-start",
                fontSize: 10.5,
                color: "var(--ink-3)",
                background: "transparent",
                cursor: loading ? "default" : "pointer",
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>

            {events !== null && events.length === 0 && !loading && (
              <p style={{ textAlign: "center", fontSize: 11.5, color: "var(--ink-3)", padding: "6px 0" }}>
                No relationship changes yet.
              </p>
            )}

            {events?.map((e, i) => {
              const deltas: [Dim, number][] = [
                ["trust", e.delta_trust],
                ["respect", e.delta_respect],
                ["vibe", e.delta_vibe],
              ];
              return (
                <div
                  key={i}
                  style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 11px" }}
                >
                  <div className="tnum" style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", fontSize: 10.5, fontWeight: 700 }}>
                    {deltas.map(([dim, d]) => (
                      <span
                        key={dim}
                        style={{ color: d > 0 ? "var(--good)" : d < 0 ? "var(--bad)" : "var(--ink-3)" }}
                      >
                        {cap(dim)} {fmtDelta(d)}
                      </span>
                    ))}
                  </div>
                  {e.reasoning && (
                    <p style={{ marginTop: 5, fontSize: 11.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
                      {e.reasoning}
                    </p>
                  )}
                  <p style={{ marginTop: 5, fontSize: 10, color: "var(--ink-3)" }}>{timeAgo(e.created_at)}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
