/**
 * Maps an NPC's free-text `archetype` to one of five coarse groups used for
 * color-coding in the relationship network. Pure + client-safe (no deps), so
 * both the API route and client graph/legend can use it.
 *
 * Keyword rules are evaluated IN ORDER, first match wins — order matters where
 * an archetype contains overlapping signals (e.g. "consulting-track CS senior"
 * is pre-professional, not tech, because the consulting rule runs before the
 * CS/tech rule). Unrecognized archetypes fall back to "wild-card".
 */

export type ArchetypeGroup =
  | "tech"
  | "humanities"
  | "pre-professional"
  | "athlete"
  | "wild-card";

const RULES: { group: ArchetypeGroup; keywords: string[] }[] = [
  {
    group: "pre-professional",
    keywords: [
      "consult", "pre-med", "premed", "mcat", "pre-law", "prelaw",
      "debat", "mba", "finance", "banking", "law school", "clerkship",
    ],
  },
  {
    group: "athlete",
    keywords: [
      "swimmer", "swim", "football", "recruit", "varsity", "athlete",
      "rower", "rowing", "basketball", "soccer", "track", "tennis",
    ],
  },
  {
    group: "humanities",
    // Avoid bare "art" (it is a substring of "start"/"startup"); use specific
    // forms so a tech archetype can't be misread as humanities.
    keywords: [
      "english", "studio art", "art major", "artist", " arts", "mfa",
      "history", "philosophy", "literature", "creative writing", "humanities",
      "poet", "film", "comparative lit",
    ],
  },
  {
    group: "wild-card",
    keywords: [
      "generalist", "symsys", "symbolic systems", "overcommitted",
      "undeclared", "undecided", "sophomore",
    ],
  },
  {
    group: "tech",
    keywords: [
      "founder", "startup", "phd", " cs", "cs ", "computer science",
      "ml ", "machine learning", "engineer", "developer", "hacker", "tech",
    ],
  },
];

export function archetypeGroup(archetype: string): ArchetypeGroup {
  const a = (archetype ?? "").toLowerCase();
  for (const { group, keywords } of RULES) {
    if (keywords.some((k) => a.includes(k))) return group;
  }
  return "wild-card";
}

/** Categorical colors for node coloring + legend. */
export const ARCHETYPE_GROUP_COLORS: Record<ArchetypeGroup, string> = {
  tech: "#2563eb", // blue
  humanities: "#ea580c", // warm orange
  "pre-professional": "#059669", // green
  athlete: "#7c3aed", // purple
  "wild-card": "#6b7280", // gray
};

export const ARCHETYPE_GROUP_LABELS: Record<ArchetypeGroup, string> = {
  tech: "Tech",
  humanities: "Humanities & Arts",
  "pre-professional": "Pre-professional",
  athlete: "Athlete",
  "wild-card": "Wild card",
};
