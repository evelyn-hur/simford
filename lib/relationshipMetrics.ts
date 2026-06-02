/**
 * Pure, isomorphic relationship math — safe to import from BOTH client and
 * server (no "server-only" guard, no heavy deps). The three primitives
 * (trust / respect / vibe, each 0–1) combine into "fun" derived labels.
 *
 * Identical for player↔NPC and NPC↔NPC relationships, since both expose the
 * same three primitives. Re-exported from lib/relationships.ts for server-side
 * callers; client components import it directly from here (lib/relationships.ts
 * is server-only and cannot be pulled into a client bundle).
 */

export interface DerivedMetrics {
  /** Respect-led. High = "I could see myself building something with them." */
  cofounder_score: number;
  /** Vibe-led. High = "we'd actually be close." */
  close_friend_score: number;
  /** Respect-led, low trust needed. High = "great to grind problem sets with." */
  study_partner_score: number;
  /** High respect, low warmth — admire their work, don't enjoy their company. */
  frenemy_score: number;
}

export type DerivedMetricKey = keyof DerivedMetrics;

/**
 * Combine the primitives into derived metrics. The first three are convex
 * weightings (weights sum to 1.0) so they stay in [0, 1]; frenemy is
 * respect × (1 − vibe), also in [0, 1].
 */
export function computeDerivedMetrics(
  trust: number,
  respect: number,
  vibe: number,
): DerivedMetrics {
  return {
    cofounder_score: respect * 0.5 + trust * 0.3 + vibe * 0.2,
    close_friend_score: vibe * 0.5 + trust * 0.4 + respect * 0.1,
    study_partner_score: respect * 0.6 + vibe * 0.3 + trust * 0.1,
    frenemy_score: respect * (1 - vibe),
  };
}

export const DERIVED_METRIC_LABELS: Record<DerivedMetricKey, string> = {
  cofounder_score: "Cofounder potential",
  close_friend_score: "Close friend",
  study_partner_score: "Study partner",
  frenemy_score: "Frenemy energy",
};

export type MetricBand = "high" | "medium" | "low";

/** Bucket a 0–1 score into a coarse label for compact display. */
export function metricBand(score: number): MetricBand {
  if (score >= 0.6) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

export interface RankedMetric {
  key: DerivedMetricKey;
  label: string;
  score: number;
  band: MetricBand;
}

/**
 * Derived metrics ranked highest-first — for compact "top N" display
 * (e.g. "Cofounder potential: high; Close friend: medium").
 */
export function rankDerivedMetrics(m: DerivedMetrics): RankedMetric[] {
  return (Object.keys(m) as DerivedMetricKey[])
    .map((key) => ({
      key,
      label: DERIVED_METRIC_LABELS[key],
      score: m[key],
      band: metricBand(m[key]),
    }))
    .sort((a, b) => b.score - a.score);
}
