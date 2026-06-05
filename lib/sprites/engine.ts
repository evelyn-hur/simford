/* ===========================================================================
   Simford — procedural pixel-art sprite engine
   ---------------------------------------------------------------------------
   Ported near-verbatim from the design handoff (engine/sprites.js) into an ES
   module. Each NPC sprite is composed from colored pixels on a 20×24 logical
   grid, then given a clean black silhouette outline (sticker style). Everything
   is parametric: skin tone, hair color + style, outfit colors and accessories
   are driven by per-character config (see lib/sprites/configs.ts). Rendered to
   a <canvas> with no smoothing for crisp pixels.
   =========================================================================== */

export interface SpriteConfig {
  skin: string;
  hairColor: string;
  hair: string;
  shirt: string;
  pants: string;
  shoes?: string;
  accessories?: Array<string | { type: string; color: string }>;
}

type Grid = (string | null)[][];

const W = 20;
const H = 24;
const OUTLINE = "#2a2420";

// ---- palette -------------------------------------------------------------
const SKIN: Record<string, { base: string; shade: string; blush: string }> = {
  porcelain: { base: "#f6d6bb", shade: "#e9bd9c", blush: "#e69a86" },
  light: { base: "#f0c8a2", shade: "#e0ad84", blush: "#dc8a73" },
  tan: { base: "#d6a173", shade: "#c2895c", blush: "#c2705a" },
  medium: { base: "#c5895a", shade: "#ad7144", blush: "#a85a47" },
  brown: { base: "#a3683d", shade: "#8a5430", blush: "#8a4534" },
  deep: { base: "#7c4a29", shade: "#653a1f", blush: "#6b3526" },
};
const HAIR: Record<string, { base: string; shade: string }> = {
  black: { base: "#26242a", shade: "#171519" },
  softblack: { base: "#2c2a33", shade: "#1c1a22" },
  darkbrown: { base: "#3f2e1e", shade: "#2c2014" },
  brown: { base: "#6a4628", shade: "#523318" },
  lightbrown: { base: "#8a6234", shade: "#6d4b24" },
  auburn: { base: "#7a3320", shade: "#5e2415" },
  blonde: { base: "#d8b160", shade: "#bd9242" },
};

type Skin = (typeof SKIN)[string];
type HairTone = (typeof HAIR)[string];

// ---- low-level paint helpers ---------------------------------------------
function grid(): Grid {
  const g: Grid = new Array(H);
  for (let y = 0; y < H; y++) g[y] = new Array(W).fill(null);
  return g;
}
function px(g: Grid, x: number, y: number, c: string | null): void {
  if (x < 0 || x >= W || y < 0 || y >= H || c == null) return;
  g[y][x] = c;
}
function rect(g: Grid, x0: number, y0: number, x1: number, y1: number, c: string | null): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(g, x, y, c);
}
function row(g: Grid, y: number, x0: number, x1: number, c: string | null): void {
  for (let x = x0; x <= x1; x++) px(g, x, y, c);
}

// ---- face ----------------------------------------------------------------
const FACE_ROWS: Record<number, [number, number]> = {
  4: [7, 12], 5: [6, 13], 6: [6, 13], 7: [6, 13], 8: [6, 13],
  9: [6, 13], 10: [6, 13], 11: [7, 12], 12: [8, 11],
};
function paintFace(g: Grid, skin: Skin): void {
  for (const [y, span] of Object.entries(FACE_ROWS)) {
    row(g, +y, span[0], span[1], skin.base);
  }
  row(g, 11, 7, 12, skin.shade);
  row(g, 12, 8, 11, skin.shade);
  rect(g, 8, 13, 11, 13, skin.shade);
}

function paintFeatures(g: Grid, skin: Skin, opts: SpriteConfig & { blush?: boolean }): void {
  const eyeY = 9;
  rect(g, 7, eyeY, 8, eyeY + 1, "#36302b");
  rect(g, 11, eyeY, 12, eyeY + 1, "#36302b");
  px(g, 7, eyeY, "#fbf6ee");
  px(g, 11, eyeY, "#fbf6ee");
  if (opts.blush !== false) {
    px(g, 6, 11, skin.blush);
    px(g, 13, 11, skin.blush);
  }
}

function shade(hex: string): string {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16);
  const gg = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const f = 0.82;
  const to = (v: number) => ("0" + Math.round(v * f).toString(16)).slice(-2);
  return "#" + to(r) + to(gg) + to(b);
}

// ---- body / outfit -------------------------------------------------------
// frame: 0/2 = neutral stance, 1 = right foot lifted, 3 = left foot lifted.
function paintBody(g: Grid, skin: Skin, cfg: SpriteConfig, frame: number): void {
  frame = frame || 0;
  const shirt = cfg.shirt;
  const shirtShade = shade(cfg.shirt);
  row(g, 14, 6, 13, shirt);
  rect(g, 6, 15, 13, 19, shirt);
  rect(g, 12, 15, 13, 19, shirtShade);
  rect(g, 5, 15, 5, 18, shirt);
  rect(g, 14, 15, 14, 18, shirtShade);
  let lHandY = 19;
  let rHandY = 19;
  if (frame === 1) { lHandY = 19; rHandY = 18; }
  else if (frame === 3) { lHandY = 18; rHandY = 19; }
  px(g, 5, lHandY, skin.base);
  px(g, 14, rHandY, skin.base);

  const pants = cfg.pants;
  const pantsShade = shade(cfg.pants);
  const shoes = cfg.shoes || "#3a322c";
  const leftLift = frame === 3;
  const rightLift = frame === 1;
  rect(g, 7, 20, 8, leftLift ? 21 : 22, pants);
  px(g, 8, leftLift ? 21 : 22, pantsShade);
  row(g, leftLift ? 22 : 23, 6, 8, shoes);
  rect(g, 10, 20, 11, rightLift ? 21 : 22, pants);
  px(g, 11, rightLift ? 21 : 22, pantsShade);
  row(g, rightLift ? 22 : 23, 10, 12, shoes);
}

// ---- hair styles ---------------------------------------------------------
const HAIRSTYLES: Record<string, (g: Grid, h: HairTone) => void> = {
  messy(g, h) {
    row(g, 2, 7, 12, h.base);
    row(g, 3, 6, 13, h.base);
    row(g, 4, 5, 14, h.base);
    row(g, 5, 5, 14, h.shade);
    px(g, 5, 6, h.base); px(g, 14, 6, h.base);
    px(g, 6, 6, h.base); px(g, 13, 6, h.base);
    px(g, 9, 6, h.base); px(g, 8, 6, h.shade); px(g, 11, 6, h.base);
    px(g, 7, 1, h.base); px(g, 10, 1, h.shade); px(g, 12, 2, h.base);
  },
  short(g, h) {
    row(g, 3, 7, 12, h.base);
    row(g, 4, 6, 13, h.base);
    row(g, 5, 6, 13, h.base);
    row(g, 6, 5, 6, h.base); row(g, 6, 13, 14, h.base);
    row(g, 5, 6, 13, h.shade);
  },
  fade(g, h) {
    row(g, 3, 7, 12, h.base);
    row(g, 4, 6, 13, h.base);
    row(g, 5, 6, 13, h.shade);
    px(g, 6, 6, h.shade); px(g, 13, 6, h.shade);
  },
  curly(g, h) {
    row(g, 2, 6, 13, h.base);
    row(g, 3, 5, 14, h.base);
    row(g, 4, 5, 14, h.base);
    row(g, 5, 5, 14, h.shade);
    px(g, 5, 6, h.base); px(g, 14, 6, h.base);
    px(g, 6, 1, h.base); px(g, 8, 1, h.base); px(g, 11, 1, h.base); px(g, 13, 1, h.base);
    px(g, 6, 6, h.base); px(g, 13, 6, h.base);
  },
  bob(g, h) {
    row(g, 2, 7, 12, h.base);
    row(g, 3, 6, 13, h.base);
    row(g, 4, 5, 14, h.base);
    for (let y = 5; y <= 12; y++) {
      px(g, 5, y, h.base);
      px(g, 14, y, y > 9 ? h.shade : h.base);
      px(g, 6, y, y > 5 && y < 7 ? h.base : y <= 6 ? h.shade : null);
    }
    px(g, 6, 5, h.base); px(g, 13, 5, h.base); px(g, 6, 6, h.shade); px(g, 13, 6, h.shade);
    px(g, 5, 12, h.base); px(g, 14, 12, h.shade);
    px(g, 5, 13, h.shade); px(g, 14, 13, h.shade);
  },
  long(g, h) {
    row(g, 2, 7, 12, h.base);
    row(g, 3, 6, 13, h.base);
    row(g, 4, 5, 14, h.base);
    px(g, 6, 5, h.base); px(g, 13, 5, h.base);
    px(g, 5, 5, h.base); px(g, 14, 5, h.shade);
    px(g, 6, 6, h.shade); px(g, 13, 6, h.shade);
    for (let y = 6; y <= 18; y++) {
      px(g, 5, y, y > 12 ? h.shade : h.base);
      px(g, 14, y, h.shade);
    }
    px(g, 4, 14, h.base); px(g, 15, 14, h.shade);
    px(g, 4, 15, h.base); px(g, 15, 15, h.shade);
    px(g, 4, 16, h.shade); px(g, 15, 16, h.shade);
  },
  ponytail(g, h) {
    row(g, 3, 7, 12, h.base);
    row(g, 4, 6, 13, h.base);
    row(g, 5, 6, 13, h.shade);
    px(g, 5, 5, h.base); px(g, 14, 5, h.base);
    px(g, 5, 6, h.base); px(g, 14, 6, h.shade);
    px(g, 15, 6, h.base);
    rect(g, 15, 7, 16, 13, h.base);
    rect(g, 16, 8, 16, 12, h.shade);
    px(g, 15, 14, h.shade);
  },
  bun(g, h) {
    row(g, 3, 7, 12, h.base);
    row(g, 4, 6, 13, h.base);
    row(g, 5, 6, 13, h.shade);
    px(g, 5, 5, h.base); px(g, 14, 5, h.base);
    px(g, 5, 6, h.base); px(g, 14, 6, h.shade);
    rect(g, 8, 0, 11, 1, h.base);
    px(g, 8, 1, h.shade); px(g, 11, 1, h.shade);
    px(g, 9, 0, h.base); px(g, 10, 0, h.shade);
  },
  highpony(g, h) {
    row(g, 3, 7, 12, h.base);
    row(g, 4, 6, 13, h.base);
    row(g, 5, 6, 13, h.shade);
    px(g, 5, 5, h.base); px(g, 14, 5, h.base);
    px(g, 5, 6, h.base); px(g, 14, 6, h.shade);
    px(g, 13, 2, h.base); px(g, 14, 1, h.base);
    rect(g, 15, 1, 16, 6, h.base);
    rect(g, 16, 2, 17, 6, h.shade);
    px(g, 16, 7, h.shade); px(g, 15, 7, h.base);
  },
};

// ---- accessories (painted last, over everything) -------------------------
const ACCESSORIES = {
  glasses(g: Grid): void {
    const rim = "#3a332d";
    const glass = "#d4e6ec";
    const pupil = "#2c2824";
    [7, 11].forEach((cx) => {
      rect(g, cx - 1, 8, cx + 1, 10, glass);
      px(g, cx, 9, pupil); px(g, cx, 10, pupil);
      px(g, cx - 1, 8, "#eef6f8");
      px(g, cx - 1, 11, rim); px(g, cx, 11, rim); px(g, cx + 1, 11, rim);
    });
    px(g, 5, 10, rim); px(g, 14, 10, rim);
  },
  stubble(g: Grid, skinName: string): void {
    const sk = SKIN[skinName] || SKIN.light;
    const c = sk.shade;
    px(g, 6, 11, c); px(g, 13, 11, c);
    px(g, 7, 12, c); px(g, 12, 12, c);
    px(g, 8, 13, c); px(g, 11, 13, c);
  },
  collar(g: Grid, color: string): void {
    const c = color;
    const cs = shade(color);
    px(g, 9, 14, c); px(g, 10, 14, c);
    px(g, 8, 15, c); px(g, 11, 15, cs);
    px(g, 9, 15, "#f4ece0"); px(g, 10, 15, "#e7ddcd");
    px(g, 6, 14, c); px(g, 13, 14, cs);
    px(g, 7, 14, cs); px(g, 12, 14, cs);
  },
  zip(g: Grid): void {
    px(g, 9, 14, "#e7ddcd"); px(g, 10, 14, "#d8cdbb");
    rect(g, 9, 15, 10, 17, shade("#bdb3a3"));
    px(g, 9, 14, "#efe7da");
  },
  jersey(g: Grid, accent: string): void {
    row(g, 14, 6, 13, accent);
    px(g, 9, 16, accent); px(g, 10, 16, accent);
    px(g, 9, 17, accent); px(g, 10, 18, accent);
  },
  bandana(g: Grid, color: string): void {
    const c = color;
    const cs = shade(color);
    row(g, 4, 5, 14, c);
    row(g, 5, 5, 14, cs);
    px(g, 4, 5, c); px(g, 4, 6, cs);
  },
  cardigan(g: Grid, color: string): void {
    const c = color;
    const cs = shade(color);
    rect(g, 5, 15, 6, 19, c);
    rect(g, 13, 15, 14, 19, cs);
    px(g, 6, 14, c); px(g, 13, 14, cs);
  },
  speckles(g: Grid): void {
    px(g, 7, 17, "#d24b54"); px(g, 11, 16, "#3a78c2");
    px(g, 9, 18, "#e8b93c"); px(g, 12, 18, "#5aa86a");
  },
  apronstrap(g: Grid): void {
    const c = shade("#9a8a5a");
    px(g, 8, 14, c); px(g, 11, 14, c);
  },
};

// ---- outline pass --------------------------------------------------------
function addOutline(g: Grid): void {
  const add: [number, number][] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x] != null) continue;
      if (
        (y > 0 && g[y - 1][x] != null) ||
        (y < H - 1 && g[y + 1][x] != null) ||
        (x > 0 && g[y][x - 1] != null) ||
        (x < W - 1 && g[y][x + 1] != null)
      ) add.push([x, y]);
    }
  }
  add.forEach(([x, y]) => { g[y][x] = OUTLINE; });
}

// ---- compose -------------------------------------------------------------
function build(cfg: SpriteConfig, frame: number): Grid {
  const g = grid();
  const skin = SKIN[cfg.skin] || SKIN.light;
  const hair = HAIR[cfg.hairColor] || HAIR.brown;

  paintFace(g, skin);
  paintBody(g, skin, cfg, frame || 0);
  paintFeatures(g, skin, cfg);
  (HAIRSTYLES[cfg.hair] || HAIRSTYLES.short)(g, hair);

  (cfg.accessories || []).forEach((a) => {
    if (a === "glasses") ACCESSORIES.glasses(g);
    else if (a === "stubble") ACCESSORIES.stubble(g, cfg.skin);
    else if (a === "zip") ACCESSORIES.zip(g);
    else if (a === "speckles") ACCESSORIES.speckles(g);
    else if (a === "apronstrap") ACCESSORIES.apronstrap(g);
    else if (typeof a === "object") {
      if (a.type === "collar") ACCESSORIES.collar(g, a.color);
      else if (a.type === "jersey") ACCESSORIES.jersey(g, a.color);
      else if (a.type === "bandana") ACCESSORIES.bandana(g, a.color);
      else if (a.type === "cardigan") ACCESSORIES.cardigan(g, a.color);
    }
  });

  addOutline(g);
  return g;
}

// cache built grids by config signature + frame
const cache = new Map<string, Grid>();
function gridFor(cfg: SpriteConfig, frame: number): Grid {
  const key = (frame || 0) + "|" + JSON.stringify(cfg);
  let g = cache.get(key);
  if (!g) {
    g = build(cfg, frame || 0);
    cache.set(key, g);
  }
  return g;
}

// ---- public render -------------------------------------------------------
function render(canvas: HTMLCanvasElement, cfg: SpriteConfig, scale: number, frame: number): void {
  scale = scale || 6;
  const g = gridFor(cfg, frame || 0);
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = g[y][x];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

export const SimSprite = { render, build, W, H, SKIN, HAIR };
