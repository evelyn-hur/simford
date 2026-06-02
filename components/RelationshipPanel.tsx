"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeDerivedMetrics,
  rankDerivedMetrics,
  type MetricBand,
} from "@/lib/relationshipMetrics";

export interface RelationshipScores {
  trust: number;
  respect: number;
  vibe: number;
}

const BAND_BADGE: Record<MetricBand, string> = {
  high: "bg-cardinal/15 text-cardinal",
  medium: "bg-neutral-200 text-neutral-600",
  low: "bg-neutral-100 text-neutral-400",
};

interface RelEvent {
  delta_trust: number;
  delta_respect: number;
  delta_vibe: number;
  reasoning: string | null;
  created_at: string;
}

const DIMS = ["trust", "respect", "vibe"] as const;
type Dim = (typeof DIMS)[number];

function pct(n: number): number {
  return Math.round(Math.min(1, Math.max(0, n)) * 100);
}

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
    <aside className="shrink-0 lg:w-80">
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Relationship with {firstName}
        </p>

        {/* Meters */}
        <div className="space-y-2.5">
          {DIMS.map((dim) => {
            const p = pct(scores[dim]);
            return (
              <div
                key={dim}
                className={`rounded-md px-1 py-0.5 transition ${
                  flash[dim] ? "bg-cardinal/5 ring-1 ring-cardinal/30" : ""
                }`}
              >
                <div className="flex items-center justify-between text-[11px] text-neutral-600">
                  <span className="capitalize">{dim}</span>
                  <span className="tabular-nums">{p}%</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-200">
                  <div
                    className="h-full rounded-full bg-cardinal transition-[width] duration-700 ease-out"
                    style={{ width: `${p}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Derived "fun" metrics — top 3, recomputed from the live scores. */}
        <div className="mt-3 rounded-lg bg-cardinal/5 px-3 py-2.5">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            What you could be
          </p>
          <div className="space-y-1">
            {topMetrics.map((m) => (
              <div
                key={m.key}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-[11px] text-neutral-600">{m.label}</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[10px] tabular-nums text-neutral-400">
                    {Math.round(m.score * 100)}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${BAND_BADGE[m.band]}`}
                  >
                    {m.band}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Relationship history */}
        <div className="mt-3 border-t border-neutral-200 pt-2">
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            className="flex w-full items-center justify-between text-[11px] font-medium text-neutral-500 transition hover:text-cardinal"
            aria-expanded={historyOpen}
          >
            <span>Relationship history</span>
            <span className="text-neutral-400">{historyOpen ? "−" : "+"}</span>
          </button>

          {historyOpen && (
            <div className="mt-2 space-y-2">
              <button
                onClick={() => void loadHistory()}
                disabled={loading}
                className="text-[10px] text-neutral-400 transition hover:text-cardinal disabled:opacity-50"
              >
                {loading ? "Loading…" : "Refresh"}
              </button>

              {events !== null && events.length === 0 && !loading && (
                <p className="py-2 text-center text-[11px] text-neutral-400">
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
                    className="rounded-md bg-white px-2.5 py-2 shadow-sm"
                  >
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px]">
                      {deltas.map(([dim, d]) => (
                        <span
                          key={dim}
                          className={
                            d > 0
                              ? "text-emerald-600"
                              : d < 0
                                ? "text-cardinal"
                                : "text-neutral-300"
                          }
                        >
                          {cap(dim)} {fmtDelta(d)}
                        </span>
                      ))}
                    </div>
                    {e.reasoning && (
                      <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
                        {e.reasoning}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-neutral-300">
                      {timeAgo(e.created_at)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
