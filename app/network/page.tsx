"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import NetworkGraph, {
  type NetworkData,
  type NetworkEdge,
} from "@/components/NetworkGraph";
import CofounderPanel, { type CofounderPair } from "@/components/CofounderPanel";
import RecentChangesPanel, {
  type RecentChange,
} from "@/components/RecentChangesPanel";

interface Timeline {
  currentDay: number;
  playerEdgesByDay: Record<string, NetworkEdge[]>;
  npcEdgesByDay: Record<string, NetworkEdge[]>;
}

interface RecentChangesResponse {
  currentDay: number;
  changes: RecentChange[];
}

const FILTERS: { key: string; label: string; hint?: string }[] = [
  { key: "default", label: "Overall", hint: "overall relationship" },
  { key: "cofounder", label: "Cofounder potential" },
  { key: "close_friend", label: "Close friends" },
  { key: "study_partner", label: "Study partners" },
  { key: "frenemy", label: "Frenemies", hint: "high respect, low vibe" },
];

export default function NetworkPage() {
  const [data, setData] = useState<NetworkData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Selection lives in the parent (controlled). Clicking a node selects it (or
  // toggles it off); clicking the background deselects.
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Pair selection (from the cofounder panel) — mutually exclusive with node sel.
  const [selectedPair, setSelectedPair] = useState<{ a: string; b: string } | null>(
    null,
  );
  // Active lens / filter.
  const [mode, setMode] = useState("default");
  // Whether the player node + its edges are shown (default on).
  const [showPlayer, setShowPlayer] = useState(true);
  // Historical snapshots + the day the slider is scrubbed to (null = live).
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [day, setDay] = useState<number | null>(null);
  // Top cofounder pairs (separate endpoint so the graph isn't blocked on the
  // reasoning LLM calls).
  const [pairs, setPairs] = useState<CofounderPair[] | null>(null);
  const [pairsError, setPairsError] = useState<string | null>(null);
  // Recent system-driven changes (polled) + a key that, when bumped, re-runs the
  // graph/timeline/pairs fetches. Bumped when the polled in-game day increases.
  const [recentChanges, setRecentChanges] = useState<RecentChange[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastDayRef = useRef<number | null>(null);

  const isLive = timeline == null || day == null || day >= timeline.currentDay;

  // Compose the displayed graph: NPC↔NPC edges are constant (priors at every
  // day); the player's edges come from the scrubbed-to day's snapshot (or the
  // live set before the timeline loads). The "Show player" toggle drops them.
  const graph = useMemo(() => {
    if (!data) return null;
    // NPC↔NPC edges come from the scrubbed-to day's snapshot (which carries the
    // systemChanged flags); fall back to the constant live set before the
    // timeline loads.
    const npcEdges: NetworkEdge[] =
      timeline && day != null
        ? timeline.npcEdgesByDay[String(day)] ?? []
        : data.edges.filter(
            (e) => e.source !== "player" && e.target !== "player",
          );
    let playerEdges: NetworkEdge[] = [];
    if (showPlayer) {
      playerEdges =
        timeline && day != null
          ? timeline.playerEdgesByDay[String(day)] ?? []
          : data.edges.filter(
              (e) => e.source === "player" || e.target === "player",
            );
    }
    const nodes = showPlayer
      ? data.nodes
      : data.nodes.filter((n) => n.id !== "player");
    return { nodes, edges: [...npcEdges, ...playerEdges] };
  }, [data, showPlayer, timeline, day]);

  // Fetch the graph data on load from the /api/network endpoint.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/network");
        const json = (await res.json()) as NetworkData & { error?: string };
        if (cancelled) return;
        if (!res.ok || json.error) {
          setError(json.error ?? `Request failed (${res.status})`);
        } else {
          setData({ nodes: json.nodes, edges: json.edges });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load network");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Fetch the top cofounder pairs separately.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/network/cofounder-pairs");
        const json = (await res.json()) as {
          pairs?: CofounderPair[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || json.error) {
          setPairsError(json.error ?? `Request failed (${res.status})`);
        } else {
          setPairs(json.pairs ?? []);
        }
      } catch (e) {
        if (!cancelled) {
          setPairsError(e instanceof Error ? e.message : "Failed to load pairs");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Fetch the historical timeline snapshots (cached client-side; the slider just
  // indexes into them, so dragging never refetches or recomputes).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/network/timeline");
        const json = (await res.json()) as Timeline & { error?: string };
        if (cancelled || !res.ok || json.error) return;
        setTimeline({
          currentDay: json.currentDay,
          playerEdgesByDay: json.playerEdgesByDay,
          npcEdgesByDay: json.npcEdgesByDay,
        });
        setDay(json.currentDay); // snap to live on (re)load
      } catch {
        // Non-critical: without the timeline the graph just stays at live state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Live update: poll the lightweight recent-changes endpoint (and refetch on
  // tab focus). It feeds the panel, and when the in-game day has advanced
  // (elsewhere — the clock lives on the chat page), bump refreshKey to refetch
  // the graph, timeline, and pairs. The first poll just seeds the day baseline.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/network/recent-changes");
        const json = (await res.json()) as RecentChangesResponse & {
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || json.error) {
          setRecentError(json.error ?? `Request failed (${res.status})`);
          return;
        }
        setRecentError(null);
        setRecentChanges(json.changes);
        if (lastDayRef.current == null) {
          lastDayRef.current = json.currentDay;
        } else if (json.currentDay > lastDayRef.current) {
          lastDayRef.current = json.currentDay;
          setRefreshKey((k) => k + 1);
        }
      } catch (e) {
        if (!cancelled) {
          setRecentError(
            e instanceof Error ? e.message : "Failed to load changes",
          );
        }
      }
    };
    poll();
    const id = setInterval(poll, 6000);
    const onFocus = () => poll();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section
        style={{
          background: "var(--panel)",
          border: "2px solid var(--line-2)",
          borderRadius: "var(--r)",
          padding: "22px 24px",
          boxShadow: "var(--shadow-card)",
          animation: "pop .3s ease both",
        }}
      >
        <div
          className="px"
          style={{ fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--accent)" }}
        >
          Network
        </div>
        <h1 className="px" style={{ fontSize: 30, margin: "6px 0 8px", lineHeight: 1.1 }}>
          The social graph
        </h1>
        <p style={{ color: "var(--ink-2)", fontSize: 14.5, margin: 0, maxWidth: 700 }}>
          Each node is a student, colored by their world (tech, humanities &amp; arts,
          pre-professional, athlete, wild card). Lines show how a pair feels about each other —
          thicker, darker lines mean a stronger tie. Drag nodes to rearrange, scroll to zoom,
          click-drag the background to pan.
        </p>
      </section>

      {/* Lens / filter control */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        {FILTERS.map((f) => {
          const active = f.key === mode;
          return (
            <button
              key={f.key}
              onClick={() => setMode(f.key)}
              title={f.hint}
              aria-pressed={active}
              className="px"
              style={{
                fontSize: 12,
                padding: "6px 13px",
                borderRadius: 20,
                cursor: "pointer",
                border: "2px solid " + (active ? "var(--accent-2)" : "var(--line-2)"),
                background: active ? "var(--accent)" : "var(--panel)",
                color: active ? "var(--accent-ink)" : "var(--ink-2)",
                transition: "background .15s, color .15s",
              }}
            >
              {f.label}
            </button>
          );
        })}

        {/* Show-player toggle */}
        <button
          onClick={() => {
            setShowPlayer((on) => {
              if (on && selectedNodeId === "player") setSelectedNodeId(null);
              return !on;
            });
          }}
          role="switch"
          aria-checked={showPlayer}
          title="Show the player node and your relationships"
          className="px"
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: 12,
            padding: "6px 13px",
            borderRadius: 20,
            cursor: "pointer",
            border: "2px solid " + (showPlayer ? "var(--accent-2)" : "var(--line-2)"),
            background: showPlayer ? "var(--accent-soft)" : "var(--panel)",
            color: showPlayer ? "var(--accent-2)" : "var(--ink-3)",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: showPlayer ? "var(--accent)" : "var(--line-2)",
            }}
          />
          Show player
        </button>
      </div>

      {/* Time slider — scrub relationship history day by day */}
      {timeline && timeline.currentDay >= 2 && day != null && (
        <div
          style={{
            background: "var(--panel)",
            border: "2px solid var(--line-2)",
            borderRadius: 14,
            boxShadow: "var(--shadow-card)",
            padding: "12px 14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 }}>
            <span
              className="px"
              style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-2)" }}
            >
              In-game day
            </span>
            <span className="px tnum" style={{ fontSize: 13, color: isLive ? "var(--accent)" : "var(--ink)" }}>
              {isLive ? `Day ${timeline.currentDay} · live` : `Day ${day}`}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={timeline.currentDay}
            step={1}
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            aria-label="In-game day"
            className="w-full accent-cardinal"
          />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, fontSize: 10, color: "var(--ink-3)" }}>
            <span>Day 1</span>
            <span>Day {timeline.currentDay} · live</span>
          </div>
        </div>
      )}

      {error ? (
        <p
          style={{
            background: "var(--accent-soft)",
            color: "var(--accent-2)",
            borderRadius: 10,
            padding: "8px 12px",
            fontSize: 13,
          }}
        >
          Failed to load network: {error}
        </p>
      ) : !graph ? (
        <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading network…</p>
      ) : (
        <NetworkGraph
          nodes={graph.nodes}
          edges={graph.edges}
          mode={mode}
          selectedNodeId={selectedNodeId}
          selectedPair={selectedPair}
          onNodeClick={(id) => {
            setSelectedPair(null);
            setSelectedNodeId((prev) => (prev === id ? null : id));
          }}
          onBackgroundClick={() => {
            setSelectedNodeId(null);
            setSelectedPair(null);
          }}
        />
      )}

      <RecentChangesPanel
        changes={recentChanges}
        loading={recentChanges === null && recentError === null}
        error={recentError}
      />

      <CofounderPanel
        pairs={pairs}
        loading={pairs === null && pairsError === null}
        error={pairsError}
        selectedPair={selectedPair}
        onSelect={(p) => {
          setSelectedNodeId(null);
          setSelectedPair((prev) =>
            prev && prev.a === p.a && prev.b === p.b ? null : { a: p.a, b: p.b },
          );
        }}
      />
    </div>
  );
}
