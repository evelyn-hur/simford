"use client";

import {
  createElement,
  useMemo,
  useRef,
  useState,
  useEffect,
  type ComponentType,
} from "react";
import dynamic from "next/dynamic";
import {
  ARCHETYPE_GROUP_COLORS,
  ARCHETYPE_GROUP_LABELS,
  type ArchetypeGroup,
} from "@/lib/archetypes";

// react-force-graph-2d touches `window`/canvas at import time, so it must be
// loaded client-only (no SSR). next/dynamic does NOT forward React refs, but we
// need the imperative instance (zoomToFit, d3Force) — so wrap the component and
// map a normal `innerRef` prop onto the real component's ref.
const ForceGraph2D = dynamic(
  async () => {
    const mod = await import("react-force-graph-2d");
    const FG = mod.default as unknown as ComponentType<Record<string, unknown>>;
    const Inner = ({
      innerRef,
      ...rest
    }: Record<string, unknown> & { innerRef?: unknown }) =>
      createElement(FG, { ref: innerRef, ...rest } as Record<string, unknown>);
    return Inner;
  },
  { ssr: false },
) as unknown as ComponentType<Record<string, unknown>>;

export interface NetworkNode {
  id: string;
  name: string;
  archetype: string;
  archetypeGroup: ArchetypeGroup | "player";
  voiceTag: string;
}

const PLAYER_ID = "player";

export interface NetworkEdge {
  source: string;
  target: string;
  trust: number;
  respect: number;
  vibe: number;
  cofounder_score: number;
  close_friend_score: number;
  study_partner_score: number;
  frenemy_score: number;
  /** NPC↔NPC tie shifted by a released off-screen event (as of the viewed day). */
  systemChanged?: boolean;
}

export interface NetworkData {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export interface NetworkGraphProps {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  /** Current lens. "default" = avg(trust,respect,vibe); else a derived metric. */
  mode?: string;
  /** Highlight this node and its ties (cardinal accent). Controlled by the parent. */
  selectedNodeId?: string | null;
  /** Highlight a specific pair: ring both nodes and isolate their edge. */
  selectedPair?: { a: string; b: string } | null;
  onNodeClick?: (id: string) => void;
  onBackgroundClick?: () => void;
}

const CARDINAL = "#8C1515";
const CREAM = "#fbfaf7";
// Accent for NPC↔NPC ties shifted by a released off-screen (system) event —
// a violet that reads distinctly against every lens palette below.
const SYSTEM_ACCENT: [number, number, number] = [124, 58, 237];
const NODE_RADIUS = 5; // uniform medium
const GROUPS = Object.keys(ARCHETYPE_GROUP_LABELS) as ArchetypeGroup[];

const MODE_LABEL: Record<string, string> = {
  default: "Overall",
  cofounder: "Cofounder",
  close_friend: "Close friend",
  study_partner: "Study partner",
  frenemy: "Frenemy",
};

// Per-lens edge palette (RGB) + how much of the graph to keep visible. Metrics
// have different value ranges, so each lens keeps roughly its strongest
// `keepTop` fraction of edges (cutoff computed per render) to stay readable.
const MODE_CONFIG: Record<
  string,
  { rgb: [number, number, number]; keepTop: number }
> = {
  default: { rgb: [107, 114, 128], keepTop: 0.7 }, // gray
  cofounder: { rgb: [13, 148, 136], keepTop: 0.3 }, // teal
  close_friend: { rgb: [202, 138, 4], keepTop: 0.35 }, // warm gold
  study_partner: { rgb: [37, 99, 235], keepTop: 0.3 }, // blue
  frenemy: { rgb: [244, 81, 30], keepTop: 0.4 }, // orange-red
};
const modeConfig = (mode: string) => MODE_CONFIG[mode] ?? MODE_CONFIG.default;

// Engine adds x/y to nodes and swaps link source/target to node refs.
type GraphNode = NetworkNode & { x?: number; y?: number };
type GraphLink = NetworkEdge & {
  source: string | GraphNode;
  target: string | GraphNode;
};

// Minimal surface of the ForceGraph2D imperative instance that we use.
interface D3Force {
  strength?: (v: number | ((link: GraphLink) => number)) => D3Force;
  distance?: (v: number) => D3Force;
}
interface ForceGraphInstance {
  d3Force?: (name: string) => D3Force | undefined;
  d3ReheatSimulation?: () => void;
  zoomToFit?: (durationMs?: number, padding?: number) => void;
}

const endId = (e: string | GraphNode) => (typeof e === "object" ? e.id : e);
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Edge weight for the current lens. "default" = avg of the three primitives. */
function linkStrength(l: GraphLink, mode: string): number {
  switch (mode) {
    case "cofounder":
      return l.cofounder_score;
    case "close_friend":
      return l.close_friend_score;
    case "study_partner":
      return l.study_partner_score;
    case "frenemy":
      return l.frenemy_score;
    default:
      return (l.trust + l.respect + l.vibe) / 3;
  }
}

// Normalize strength within [0.3, 0.7] → [0, 1] for thickness/opacity.
const norm = (s: number) => Math.max(0, Math.min(1, (s - 0.3) / 0.4));

// Layout pull per link: strong-for-this-lens ties pull harder so clusters form
// under the lens; ties below the visible cutoff barely pull at all.
function linkForceStrength(l: GraphLink, mode: string, cutoff: number): number {
  const sv = linkStrength(l, mode);
  return sv >= cutoff ? 0.05 + norm(sv) * 0.3 : 0.012;
}

function voiceShort(v: string): string {
  if (!v) return "";
  const first = v.split(/[;—]/)[0].trim();
  return first.length > 110 ? `${first.slice(0, 110).trim()}…` : first;
}

export default function NetworkGraph({
  nodes,
  edges,
  mode = "default",
  selectedNodeId = null,
  selectedPair = null,
  onNodeClick,
  onBackgroundClick,
}: NetworkGraphProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphInstance | null>(null);
  const configuredRef = useRef(false);
  const [width, setWidth] = useState(0);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<GraphLink | null>(null);
  const [dimming, setDimming] = useState(false);
  const height = 560;

  // Size the canvas to the container.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Copy so the force engine's in-place mutations don't touch parent state.
  // Node objects are memoized on `nodes` ALONE (not edges) and the engine
  // mutates x/y onto them — so when only the edges change (e.g. dragging the
  // time slider, which only swaps the player's links), node positions are
  // preserved and the layout doesn't re-shuffle.
  const stableNodes = useMemo(() => nodes.map((n) => ({ ...n })), [nodes]);
  const graphData = useMemo(
    () => ({ nodes: stableNodes, links: edges.map((e) => ({ ...e })) }),
    [stableNodes, edges],
  );

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    nodes.forEach((n) => m.set(n.id, n.name));
    return m;
  }, [nodes]);

  // Visibility cutoff: keep the strongest `keepTop` fraction of edges for the
  // current lens (percentile-based, so it adapts to each metric's range).
  const cutoff = useMemo(() => {
    const cfg = modeConfig(mode);
    const vals = edges
      .map((e) => linkStrength(e as GraphLink, mode))
      .sort((a, b) => a - b);
    if (vals.length === 0) return 0;
    const idx = Math.min(
      vals.length - 1,
      Math.floor((1 - cfg.keepTop) * vals.length),
    );
    return vals[idx];
  }, [edges, mode]);

  const [mr, mg, mb] = modeConfig(mode).rgb;

  // Tune the simulation once the graph instance mounts.
  const handleRef = (instance: ForceGraphInstance | null) => {
    fgRef.current = instance;
    if (!instance || configuredRef.current) return;
    configuredRef.current = true;
    instance.d3Force?.("charge")?.strength?.(-280);
    const link = instance.d3Force?.("link");
    link?.distance?.(75);
    link?.strength?.((l: GraphLink) => linkForceStrength(l, mode, cutoff));
    instance.d3ReheatSimulation?.();
  };

  // On lens change: re-weight the layout forces and re-run it briefly so
  // clusters reform under the new lens, plus a short fade for polish.
  useEffect(() => {
    setDimming(true);
    const t = setTimeout(() => setDimming(false), 280);
    const fg = fgRef.current;
    if (fg) {
      fg.d3Force?.("link")?.strength?.((l: GraphLink) =>
        linkForceStrength(l, mode, cutoff),
      );
      fg.d3ReheatSimulation?.();
    }
    return () => clearTimeout(t);
  }, [mode, cutoff]);

  const connectsTo = (l: GraphLink, id: string | null) =>
    !!id && (endId(l.source) === id || endId(l.target) === id);

  const pairEdge = (l: GraphLink) =>
    !!selectedPair &&
    ((endId(l.source) === selectedPair.a && endId(l.target) === selectedPair.b) ||
      (endId(l.source) === selectedPair.b && endId(l.target) === selectedPair.a));

  const isHighlightedNode = (id: string) =>
    id === selectedNodeId ||
    (!!selectedPair && (id === selectedPair.a || id === selectedPair.b));

  const counts = GROUPS.map((group) => ({
    group,
    n: nodes.filter((node) => node.archetypeGroup === group).length,
  }));

  const graphProps: Record<string, unknown> = {
    innerRef: handleRef,
    graphData,
    width,
    height,
    backgroundColor: CREAM,
    enableNodeDrag: true,
    minZoom: 0.4,
    maxZoom: 6,
    cooldownTicks: 150,
    onEngineStop: () => fgRef.current?.zoomToFit?.(400, 60),

    // ── Tooltips ────────────────────────────────────────────────────────────
    nodeLabel: (node: GraphNode) =>
      `<div style="max-width:240px;line-height:1.35">` +
      `<div style="font-weight:600">${node.name}</div>` +
      `<div style="opacity:.8">${node.archetype}</div>` +
      (node.voiceTag
        ? `<div style="font-style:italic;opacity:.7;margin-top:2px">“${voiceShort(
            node.voiceTag,
          )}”</div>`
        : "") +
      `</div>`,
    linkLabel: (l: GraphLink) => {
      const a = nameById.get(endId(l.source)) ?? endId(l.source);
      const b = nameById.get(endId(l.target)) ?? endId(l.target);
      const label = MODE_LABEL[mode] ?? "Overall";
      return (
        `<div style="line-height:1.4">` +
        `<div style="font-weight:600">${a} ↔ ${b}</div>` +
        `<div>Trust ${pct(l.trust)} · Respect ${pct(l.respect)} · Vibe ${pct(
          l.vibe,
        )}</div>` +
        `<div style="opacity:.85">${label}: ${pct(linkStrength(l, mode))}</div>` +
        (l.systemChanged
          ? `<div style="color:#7c3aed;font-weight:600;margin-top:2px">· recently shifted (off-screen event)</div>`
          : "") +
        `</div>`
      );
    },

    // ── Events ──────────────────────────────────────────────────────────────
    onNodeHover: (node: GraphNode | null) =>
      setHoveredNodeId(node ? node.id : null),
    onLinkHover: (link: GraphLink | null) => setHoveredLink(link),
    onNodeClick: (node: GraphNode) => onNodeClick?.(node.id),
    onBackgroundClick: () => onBackgroundClick?.(),

    // ── Edge styling (per-lens palette, with selection/hover overrides) ───────
    // A selected node reveals all its ties, and an isolated pair's edge is always
    // shown — even below the lens cutoff. Otherwise apply the cutoff.
    linkVisibility: (l: GraphLink) =>
      pairEdge(l) ||
      connectsTo(l, selectedNodeId) ||
      linkStrength(l, mode) >= cutoff,
    linkWidth: (l: GraphLink) => {
      const w = 0.5 + norm(linkStrength(l, mode)) * 4.5;
      if (hoveredLink === l) return w + 1.5;
      if (selectedPair) return pairEdge(l) ? w + 2 : w * 0.8;
      if (selectedNodeId) return connectsTo(l, selectedNodeId) ? w + 1 : w;
      if (hoveredNodeId && connectsTo(l, hoveredNodeId)) return w + 0.6;
      // System-shifted ties read a touch heavier so the accent is legible.
      return l.systemChanged ? w + 0.8 : w;
    },
    linkColor: (l: GraphLink) => {
      const s = norm(linkStrength(l, mode));
      // Edge under the cursor always pops (so its tooltip reads clearly).
      if (hoveredLink === l) return `rgba(140, 21, 21, ${0.5 + s * 0.4})`;
      // Isolated pair: their edge is cardinal + fully opaque; all others fade out.
      if (selectedPair) {
        return pairEdge(l)
          ? `rgba(140, 21, 21, ${0.85 + s * 0.15})`
          : `rgba(${mr}, ${mg}, ${mb}, 0.1)`;
      }
      // Committed selection: connected ties cardinal + (near) fully opaque;
      // unconnected ties drop to ~20% (in the lens color).
      if (selectedNodeId) {
        return connectsTo(l, selectedNodeId)
          ? `rgba(140, 21, 21, ${0.8 + s * 0.2})`
          : `rgba(${mr}, ${mg}, ${mb}, ${0.14 + s * 0.06})`;
      }
      // Uncommitted node hover: gentle pull-forward in the lens color.
      if (hoveredNodeId) {
        return connectsTo(l, hoveredNodeId)
          ? `rgba(${mr}, ${mg}, ${mb}, ${Math.max(0.55, 0.2 + s * 0.6)})`
          : `rgba(${mr}, ${mg}, ${mb}, ${(0.15 + s * 0.5) * 0.6})`;
      }
      // Default view: ties shifted by a released off-screen event take the
      // violet system accent so they stand out from the constant-prior ties.
      if (l.systemChanged) {
        const [sr, sg, sb] = SYSTEM_ACCENT;
        return `rgba(${sr}, ${sg}, ${sb}, ${0.5 + s * 0.4})`;
      }
      return `rgba(${mr}, ${mg}, ${mb}, ${0.15 + s * 0.55})`;
    },

    // ── Nodes ─────────────────────────────────────────────────────────────────
    nodeCanvasObjectMode: () => "replace",
    nodeCanvasObject: (
      node: GraphNode,
      ctx: CanvasRenderingContext2D,
      globalScale: number,
    ) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const selected = isHighlightedNode(node.id);
      const hovered = node.id === hoveredNodeId && !selected;

      // The player is a cardinal dot — same shape and size as the NPC discs,
      // just colored cardinal so "you" stands out.
      ctx.beginPath();
      ctx.arc(x, y, NODE_RADIUS, 0, 2 * Math.PI);
      ctx.fillStyle =
        node.id === PLAYER_ID
          ? CARDINAL
          : ARCHETYPE_GROUP_COLORS[node.archetypeGroup as ArchetypeGroup] ??
            "#6b7280";
      ctx.fill();

      if (selected) {
        ctx.lineWidth = 2 / globalScale;
        ctx.strokeStyle = CARDINAL;
        ctx.stroke();
      } else if (hovered) {
        ctx.lineWidth = 1.5 / globalScale;
        ctx.strokeStyle = "rgba(120,120,120,0.8)";
        ctx.stroke();
      }

      const fontSize = 11 / globalScale;
      ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = selected ? CARDINAL : "#404040";
      ctx.fillText(node.name, x, y + NODE_RADIUS + 1.5);
    },
    nodePointerAreaPaint: (
      node: GraphNode,
      color: string,
      ctx: CanvasRenderingContext2D,
    ) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, NODE_RADIUS + 2, 0, 2 * Math.PI);
      ctx.fill();
    },
  };

  return (
    <div className="space-y-3">
      <div
        ref={wrapRef}
        style={{ height, opacity: dimming ? 0.78 : 1 }}
        className="overflow-hidden rounded-2xl border border-neutral-200 transition-opacity duration-300"
      >
        {width > 0 && <ForceGraph2D {...graphProps} />}
      </div>

      {/* Color legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {counts.map(({ group, n }) => (
          <span
            key={group}
            className="inline-flex items-center gap-1.5 text-xs text-neutral-600"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: ARCHETYPE_GROUP_COLORS[group] }}
            />
            {ARCHETYPE_GROUP_LABELS[group]}{" "}
            <span className="text-neutral-400">({n})</span>
          </span>
        ))}
        {edges.some((e) => e.systemChanged) && (
          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: "#7c3aed" }}
            />
            recently shifted
          </span>
        )}
        {(selectedNodeId || selectedPair) && (
          <span className="text-xs text-neutral-400">
            ·{" "}
            {selectedPair
              ? `${nameById.get(selectedPair.a) ?? selectedPair.a} ↔ ${
                  nameById.get(selectedPair.b) ?? selectedPair.b
                }`
              : nameById.get(selectedNodeId as string) ?? selectedNodeId}{" "}
            selected — click the background to deselect
          </span>
        )}
      </div>
    </div>
  );
}
