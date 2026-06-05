/* Per-character sprite appearance — ported from the design handoff
   (engine/sprite-configs.js). Each NPC's look (skin, hair, outfit, accessories)
   is matched to their profile and drives the procedural sprite in
   lib/sprites/engine.ts. Keyed by NPC id. */

import type { SpriteConfig } from "./engine";

export const SPRITE_CONFIGS: Record<string, SpriteConfig> = {
  jake: { skin: "light", hairColor: "brown", hair: "messy", shirt: "#5d6b7a", pants: "#363b43", shoes: "#2c2823", accessories: ["zip"] },
  priya: { skin: "tan", hairColor: "black", hair: "long", shirt: "#3c3a46", pants: "#2c2c33", shoes: "#222026", accessories: ["glasses"] },
  ben: { skin: "light", hairColor: "brown", hair: "messy", shirt: "#8a3b34", pants: "#48505a", shoes: "#33302b", accessories: ["glasses", "stubble", { type: "collar", color: "#6e2f29" }] },
  eliza: { skin: "porcelain", hairColor: "auburn", hair: "bob", shirt: "#37533f", pants: "#5a4636", shoes: "#3a2f26" },
  june: { skin: "light", hairColor: "black", hair: "bob", shirt: "#9a8a5a", pants: "#456076", shoes: "#2f2a24", accessories: [{ type: "bandana", color: "#c2604a" }, "speckles", "apronstrap"] },
  marcus: { skin: "brown", hairColor: "black", hair: "fade", shirt: "#2f3a52", pants: "#262b36", shoes: "#1f1d22", accessories: [{ type: "collar", color: "#1f2738" }] },
  alex: { skin: "medium", hairColor: "black", hair: "short", shirt: "#2f6f68", pants: "#454b54", shoes: "#33302b" },
  maya: { skin: "light", hairColor: "darkbrown", hair: "ponytail", shirt: "#6e2233", pants: "#33343a", shoes: "#26242a", accessories: [{ type: "collar", color: "#581b29" }] },
  dj: { skin: "deep", hairColor: "black", hair: "fade", shirt: "#8C1515", pants: "#2a2f3a", shoes: "#e9e2d4", accessories: [{ type: "jersey", color: "#f4ece0" }] },
  sasha: { skin: "light", hairColor: "blonde", hair: "bun", shirt: "#34506e", pants: "#3a3f47", shoes: "#2c2823", accessories: ["zip"] },
  theo: { skin: "tan", hairColor: "darkbrown", hair: "curly", shirt: "#b07d2e", pants: "#5a4636", shoes: "#33302b", accessories: ["glasses", { type: "cardigan", color: "#7a4a8a" }] },
  riya: { skin: "tan", hairColor: "black", hair: "highpony", shirt: "#c85a4a", pants: "#456076", shoes: "#2f2a24" },
};
