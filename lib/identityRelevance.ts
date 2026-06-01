// Pure identity-relevance scoring (no DB / server deps), so it's unit-testable.

const IDENTITY_RELEVANCE_NORM = 3; // this many distinct keyword hits = full 1.0

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile identity keywords into case-insensitive, word-boundary matchers.
 *
 * `\b{keyword}\b` avoids substring false positives ("ship" no longer matches
 * "relationship", "vc" no longer matches "advice"). Multi-word keywords like
 * "Cardinal Ventures" are matched as a single phrase — boundaries sit only at
 * the ends, not on each token, and the internal space is matched literally.
 */
export function buildKeywordMatchers(keywords: string[]): RegExp[] {
  return keywords
    .filter(Boolean)
    .map((k) => new RegExp(`\\b${escapeRegExp(k)}\\b`, "i"));
}

/**
 * Identity relevance in [0, 1]: the count of distinct keyword matchers that
 * hit the content, normalized by IDENTITY_RELEVANCE_NORM and clamped.
 */
export function computeIdentityRelevance(
  content: string,
  matchers: RegExp[],
): number {
  if (matchers.length === 0) return 0;
  let matched = 0;
  for (const re of matchers) {
    if (re.test(content)) matched++;
  }
  return Math.min(1, matched / IDENTITY_RELEVANCE_NORM);
}
