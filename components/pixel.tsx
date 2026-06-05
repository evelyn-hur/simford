"use client";

/* Shared cozy-pixel UI primitives, ported from the design handoff (engine/sim-ui.jsx):
   Sprite (walk-on-hover canvas), PixelTree (redwood logo), SpriteStage, Meter(s),
   BandTag, Pill, GameButton, BondPips. Inline styles intentionally reference the
   CSS theme tokens (var(--…)) so they track the Day/Dusk theme. */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { SimSprite } from "@/lib/sprites/engine";
import { SPRITE_CONFIGS } from "@/lib/sprites/configs";

export const pct = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100);

export function bondLevel(t: number, r: number, v: number): { n: number; label: string } {
  const avg = (t + r + v) / 3;
  if (avg >= 0.66) return { n: 4, label: "Close" };
  if (avg >= 0.52) return { n: 3, label: "Warming" };
  if (avg >= 0.42) return { n: 2, label: "Acquainted" };
  return { n: 1, label: "New" };
}

// ---- Sprite canvas (walk cycle on hover) ---------------------------------
const WALK_FRAMES = [0, 1, 2, 3];
export function Sprite({
  id,
  scale = 6,
  walk = false,
  className,
  style,
}: {
  id: string;
  scale?: number;
  walk?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cfg = SPRITE_CONFIGS[id];
    if (!ref.current || !cfg) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!walk || reduce) {
      SimSprite.render(ref.current, cfg, scale, 0);
      return;
    }
    let i = 0;
    const draw = (f: number) => ref.current && SimSprite.render(ref.current, cfg, scale, f);
    draw(WALK_FRAMES[0]); // paint immediately so the canvas is never blank
    const timer = setInterval(() => {
      i = (i + 1) % WALK_FRAMES.length;
      draw(WALK_FRAMES[i]);
    }, 1000 / 8); // ~8fps walk cycle
    return () => clearInterval(timer);
  }, [id, scale, walk]);
  return <canvas ref={ref} className={"sprite " + (className || "")} style={style} aria-hidden="true" />;
}

// ---- Pixel coast redwood mark --------------------------------------------
const TREE_ROWS = [
  "....F....",
  "...FFF...",
  "..FFFFF..",
  "...FFF...",
  "..FFFFF..",
  ".FFFFFFF.",
  "..FFFFF..",
  "FFFFFFFFF",
  "..FFFFF..",
  "...ttt...",
  "...ttt...",
  "...ttt...",
  "...ttt...",
  "..ttttt..",
];
export function PixelTree({ scale = 2, style }: { scale?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const Ht = TREE_ROWS.length;
    const Wt = TREE_ROWS[0].length;
    const mid = Wt / 2;
    const fol = "#3f7a4a";
    const folShade = "#2f5d39";
    const trunk = "#8a4630";
    const trunkShade = "#6f3522";
    const out = "#23341e";
    const g: (string | null)[][] = TREE_ROWS.map((r) => Array.from(r, () => null));
    for (let y = 0; y < Ht; y++)
      for (let x = 0; x < Wt; x++) {
        const ch = TREE_ROWS[y][x];
        if (ch === "F") g[y][x] = x >= mid ? folShade : fol;
        else if (ch === "t") g[y][x] = x >= mid ? trunkShade : trunk;
      }
    ([[4, 4], [2, 6], [6, 7], [4, 2]] as [number, number][]).forEach(([x, y]) => {
      if (g[y][x]) g[y][x] = folShade;
    });
    const add: [number, number][] = [];
    for (let y = 0; y < Ht; y++)
      for (let x = 0; x < Wt; x++) {
        if (g[y][x]) continue;
        if (
          (y > 0 && g[y - 1][x]) ||
          (y < Ht - 1 && g[y + 1][x]) ||
          (x > 0 && g[y][x - 1]) ||
          (x < Wt - 1 && g[y][x + 1])
        )
          add.push([x, y]);
      }
    add.forEach(([x, y]) => {
      g[y][x] = out;
    });
    c.width = Wt * scale;
    c.height = Ht * scale;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    for (let y = 0; y < Ht; y++)
      for (let x = 0; x < Wt; x++) {
        if (g[y][x]) {
          ctx.fillStyle = g[y][x] as string;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
  }, [scale]);
  return <canvas ref={ref} className="sprite" style={style} aria-hidden="true" />;
}

// ---- Sprite on a soft tinted tile with a ground shadow -------------------
export function SpriteStage({
  id,
  scale = 6,
  pad = 14,
  tone = "var(--panel-3)",
  float = false,
  walk = false,
  round = 18,
}: {
  id: string;
  scale?: number;
  pad?: number;
  tone?: string;
  float?: boolean;
  walk?: boolean;
  round?: number;
}) {
  const w = SimSprite.W * scale;
  return (
    <div
      style={{
        position: "relative",
        background: tone,
        borderRadius: round,
        padding: pad,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          bottom: pad - 2,
          left: "50%",
          transform: "translateX(-50%)",
          width: w * 0.62,
          height: w * 0.16,
          borderRadius: "50%",
          background: "rgba(0,0,0,.16)",
          filter: "blur(2px)",
        }}
      />
      <div style={{ position: "relative", animation: float ? "floaty 4s ease-in-out infinite" : "none" }}>
        <Sprite id={id} scale={scale} walk={walk} />
      </div>
    </div>
  );
}

// ---- meters --------------------------------------------------------------
export type Dim = "trust" | "respect" | "vibe";
export const DIM_COLOR: Record<Dim, string> = {
  trust: "var(--trust)",
  respect: "var(--respect)",
  vibe: "var(--vibe)",
};
export function Meter({ dim, value, big = false, flash = false }: { dim: Dim; value: number; big?: boolean; flash?: boolean }) {
  const p = pct(value);
  return (
    <div style={{ borderRadius: 8, padding: flash ? "2px 4px" : 0, margin: flash ? "-2px -4px" : 0, background: flash ? "var(--accent-soft)" : "transparent", transition: "background .5s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
        <span className="px" style={{ fontSize: big ? 12 : 10.5, textTransform: "uppercase", letterSpacing: 1, color: "var(--ink-2)" }}>
          {dim}
        </span>
        <span className="px tnum" style={{ fontSize: big ? 13 : 11, color: DIM_COLOR[dim] }}>
          {p}
        </span>
      </div>
      <div style={{ height: big ? 9 : 7, borderRadius: 20, background: "var(--panel-3)", overflow: "hidden", border: "1px solid var(--line)" }}>
        <div style={{ width: p + "%", height: "100%", borderRadius: 20, background: DIM_COLOR[dim], transition: "width .5s ease" }} />
      </div>
    </div>
  );
}

export function Meters({ scores, big }: { scores: { trust: number; respect: number; vibe: number }; big?: boolean }) {
  return (
    <div style={{ display: "grid", gap: big ? 11 : 8 }}>
      <Meter dim="trust" value={scores.trust} big={big} />
      <Meter dim="respect" value={scores.respect} big={big} />
      <Meter dim="vibe" value={scores.vibe} big={big} />
    </div>
  );
}

// ---- small bits ----------------------------------------------------------
type Band = "high" | "medium" | "low";
const BAND_STYLE: Record<Band, CSSProperties> = {
  high: { background: "var(--accent-soft)", color: "var(--accent-2)" },
  medium: { background: "var(--panel-3)", color: "var(--ink-2)" },
  low: { background: "transparent", color: "var(--ink-3)" },
};
export function BandTag({ b }: { b: Band }) {
  return (
    <span className="px" style={{ ...BAND_STYLE[b], fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.6, padding: "2px 6px", borderRadius: 6 }}>
      {b}
    </span>
  );
}

export function Pill({ children, color, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <span
      className="px"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10.5,
        letterSpacing: 0.4,
        color: color || "var(--ink-2)",
        background: "var(--panel-3)",
        border: "1px solid var(--line)",
        padding: "3px 9px",
        borderRadius: 20,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// chunky pressable button
export function GameButton({
  children,
  onClick,
  primary,
  small,
  disabled,
  style,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  small?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
  title?: string;
  type?: "button" | "submit";
}) {
  const [down, setDown] = useState(false);
  const base: CSSProperties = {
    fontFamily: "var(--font-pixel), monospace",
    fontWeight: 600,
    letterSpacing: 0.4,
    fontSize: small ? 12 : 13.5,
    padding: small ? "7px 13px" : "10px 18px",
    borderRadius: 12,
    border: "2px solid",
    cursor: disabled ? "default" : "pointer",
    transition: "transform .04s, box-shadow .04s, background .15s",
    whiteSpace: "nowrap",
    opacity: disabled ? 0.5 : 1,
  };
  const skin: CSSProperties = primary
    ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent-2)" }
    : { background: "var(--panel)", color: "var(--ink)", borderColor: "var(--line-2)" };
  const shadow = primary ? "var(--shadow-btn-accent)" : "var(--shadow-btn)";
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onMouseLeave={() => setDown(false)}
      style={{
        ...base,
        ...skin,
        boxShadow: disabled ? "none" : down ? "0 1px 0 var(--line-2)" : shadow,
        transform: down && !disabled ? "translateY(2px)" : "none",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// heart-ish bond pips (diamonds)
export function BondPips({ n }: { n: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: 2,
            transform: "rotate(45deg)",
            background: i <= n ? "var(--accent)" : "var(--panel-3)",
            border: "1px solid " + (i <= n ? "var(--accent-2)" : "var(--line-2)"),
          }}
        />
      ))}
    </span>
  );
}
