"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NetworkGraph, {
  type NetworkData,
  type NetworkEdge,
} from "@/components/NetworkGraph";
import CofounderPanel, { type CofounderPair } from "@/components/CofounderPanel";

interface Timeline {
  currentDay: number;
  playerEdgesByDay: Record<string, NetworkEdge[]>;
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

  const isLive = timeline == null || day == null || day >= timeline.currentDay;

  // Compose the displayed graph: NPC↔NPC edges are constant (priors at every
  // day); the player's edges come from the scrubbed-to day's snapshot (or the
  // live set before the timeline loads). The "Show player" toggle drops them.
  const graph = useMemo(() => {
    if (!data) return null;
    const npcEdges = data.edges.filter(
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
  }, []);

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
  }, []);

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
        });
        setDay(json.currentDay); // start at "live"
      } catch {
        // Non-critical: without the timeline the graph just stays at live state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">
            Stanford Society — Social Network
          </h1>
          <Link
            href="/"
            className="text-sm text-neutral-400 transition hover:text-cardinal"
          >
            ← Back
          </Link>
        </div>
        <p className="max-w-prose text-neutral-600">
          Each node is a student, colored by their world (tech, humanities &amp;
          arts, pre-professional, athlete, wild card). Lines show how a pair
          feels about each other — thicker, darker lines mean a stronger tie
          (trust, respect, and vibe combined). Drag nodes to rearrange, scroll
          to zoom, click-drag the background to pan.
        </p>
      </header>

      {/* Lens / filter control */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const active = f.key === mode;
          return (
            <button
              key={f.key}
              onClick={() => setMode(f.key)}
              title={f.hint}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-cardinal bg-cardinal/10 text-cardinal"
                  : "border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
              }`}
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
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            showPlayer
              ? "border-cardinal bg-cardinal/10 text-cardinal"
              : "border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-900"
          }`}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              showPlayer ? "bg-cardinal" : "bg-neutral-300"
            }`}
          />
          Show player
        </button>
      </div>

      {/* Time slider — scrub relationship history day by day */}
      {timeline && timeline.currentDay >= 2 && day != null && (
        <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
          <div className="mb-1.5 flex items-baseline justify-between text-xs">
            <span className="font-medium text-neutral-600">In-game day</span>
            <span
              className={
                isLive
                  ? "font-semibold text-cardinal"
                  : "font-semibold text-neutral-700"
              }
            >
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
          <div className="mt-0.5 flex justify-between text-[10px] text-neutral-400">
            <span>Day 1</span>
            <span>Day {timeline.currentDay} · live</span>
          </div>
        </div>
      )}

      {error ? (
        <p className="rounded-lg bg-cardinal/5 px-3 py-2 text-sm text-cardinal">
          Failed to load network: {error}
        </p>
      ) : !graph ? (
        <p className="text-sm text-neutral-400">Loading network…</p>
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
