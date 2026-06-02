/**
 * NPC seed data.
 *
 * NPCs live as one Markdown file per character in `data/npcs/`. The YAML
 * frontmatter holds the structured metadata (id, name, archetype,
 * speaking_style, judge_summary, identity_keywords, values) and the Markdown
 * body is the `identity_prompt` — written in the second person ("You are ...")
 * and fed to Claude as the system prompt.
 *
 * This module reads those files synchronously at import time and exposes them
 * as `npcs`, matching the shape the seed script upserts into the `npcs` table.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

export interface NPCSeed {
  id: string;
  name: string;
  archetype: string;
  identity_prompt: string;
  speaking_style: string;
  values_json: Record<string, unknown>;
  /**
   * Condensed 2-3 sentence values summary for the relationship-judge prompt
   * (cheaper than shipping the full identity / values_json). Should capture
   * what earns the NPC's respect, trust, and warmth.
   */
  judge_summary: string;
  /**
   * Topics this NPC cares about. Substring-matched (lowercased) against memory
   * content to boost identity-relevant memories during retrieval re-ranking.
   */
  identity_keywords: string[];
}

const NPC_DIR = join(__dirname, "npcs");

function parseNpcFile(fileName: string): NPCSeed {
  const raw = readFileSync(join(NPC_DIR, fileName), "utf8");
  const { data, content } = matter(raw);

  const identity_prompt = content.trim();

  const missing = (["id", "name", "archetype", "speaking_style", "judge_summary"] as const).filter(
    (key) => typeof data[key] !== "string" || (data[key] as string).trim() === "",
  );
  if (missing.length > 0) {
    throw new Error(`${fileName}: missing/invalid frontmatter field(s): ${missing.join(", ")}`);
  }
  if (!Array.isArray(data.identity_keywords)) {
    throw new Error(`${fileName}: 'identity_keywords' must be a list`);
  }
  if (!identity_prompt) {
    throw new Error(`${fileName}: Markdown body (identity_prompt) is empty`);
  }

  return {
    id: data.id,
    name: data.name,
    archetype: data.archetype,
    speaking_style: data.speaking_style.trim(),
    judge_summary: data.judge_summary.trim(),
    identity_keywords: data.identity_keywords.map((k: unknown) => String(k)),
    values_json: (data.values ?? {}) as Record<string, unknown>,
    identity_prompt,
  };
}

function loadNpcs(): NPCSeed[] {
  const files = readdirSync(NPC_DIR)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort();
  return files.map(parseNpcFile);
}

export const npcs: NPCSeed[] = loadNpcs();
