/**
 * Initial NPC↔NPC relationship priors — seed state for `npc_npc_relationships`.
 *
 * UNDIRECTED: one row per unordered pair (66 = 12 choose 2). `npc_a_id` is the
 * alphabetically-earlier id and `npc_b_id` the later one, so a future consumer
 * can normalize a lookup by sorting the two ids. Relationships are really
 * asymmetric (Jake is intimidated by Priya more than she cares about him); for
 * now the trust/respect/vibe here describe the *blended* prior and the `notes`
 * field records the asymmetry so it can be split into directed perspectives
 * later (e.g. via inter_npc_events).
 *
 * Fields:
 * - archetype_affinity_prior (0–1): how naturally these two archetypes cluster,
 *   independent of the specific characters. Same value for every pair drawn from
 *   the same two clusters. Cluster scheme:
 *     tech   = jake, priya, ben      hum  = eliza, june
 *     pre    = marcus, alex, maya     ath  = dj, sasha
 *     wild   = theo, riya  (bridge archetypes)
 *   Cluster-pair affinities: tech·tech .70, hum·hum .75, ath·ath .70,
 *   pre·pre/wild·anything .60 (wild bridges), tech·pre .55, pre·ath & ath·wild
 *   .45, hum·pre .40, tech·hum/tech·ath/hum·ath .30.
 * - trust / respect / vibe: start near 0.5, nudged by the affinity prior and
 *   then overridden by specific canon from the NPC identity files. Note these
 *   diverge from affinity for canon pairs (e.g. alex↔dj are close friends at
 *   trust 0.58 despite a pre·ath affinity of only 0.45) — that gap is the point.
 * - notes: brief reason for any non-baseline values; documents asymmetry.
 *
 * `notes` is NOT a column on `npc_npc_relationships`; the seed script inserts
 * only the numeric/id columns. Notes live here as design documentation.
 */

export interface NPCRelationshipSeed {
  npc_a_id: string;
  npc_b_id: string;
  trust: number;
  respect: number;
  vibe: number;
  archetype_affinity_prior: number;
  notes: string;
}

export const npcRelationships: NPCRelationshipSeed[] = [
  // ── alex ──────────────────────────────────────────────────────────────────
  { npc_a_id: "alex", npc_b_id: "ben", trust: 0.52, respect: 0.5, vibe: 0.53, archetype_affinity_prior: 0.55,
    notes: "Ben instinctively looks out for someone grinding as hard and as quietly as Alex." },
  { npc_a_id: "alex", npc_b_id: "dj", trust: 0.58, respect: 0.52, vibe: 0.57, archetype_affinity_prior: 0.45,
    notes: "Close, roommate-adjacent; an unspoken pact not to make each other admit the hard stuff — loyal, easy, a little avoidant." },
  { npc_a_id: "alex", npc_b_id: "eliza", trust: 0.49, respect: 0.5, vibe: 0.49, archetype_affinity_prior: 0.4,
    notes: "Little overlap; Eliza finds Alex earnest but unprovocative." },
  { npc_a_id: "alex", npc_b_id: "jake", trust: 0.5, respect: 0.5, vibe: 0.5, archetype_affinity_prior: 0.55,
    notes: "Cordial but not close; little shared ground beyond ambition." },
  { npc_a_id: "alex", npc_b_id: "june", trust: 0.49, respect: 0.5, vibe: 0.49, archetype_affinity_prior: 0.4,
    notes: "Minimal contact; mild mutual respect for each other's grind." },
  { npc_a_id: "alex", npc_b_id: "marcus", trust: 0.5, respect: 0.5, vibe: 0.52, archetype_affinity_prior: 0.6,
    notes: "Gym acquaintances who keep it pleasantly surface-level — a mutual rest from intensity." },
  { npc_a_id: "alex", npc_b_id: "maya", trust: 0.58, respect: 0.55, vibe: 0.57, archetype_affinity_prior: 0.6,
    notes: "Fellow grinders (pre-med/pre-law) who keep parallel company and mirror each other's pressure — closest each has to someone who gets it." },
  { npc_a_id: "alex", npc_b_id: "priya", trust: 0.5, respect: 0.5, vibe: 0.49, archetype_affinity_prior: 0.55,
    notes: "Minimal contact; Priya tolerates Alex's earnest diligence." },
  { npc_a_id: "alex", npc_b_id: "riya", trust: 0.52, respect: 0.51, vibe: 0.52, archetype_affinity_prior: 0.55,
    notes: "Kindred overextended strivers who'd recognize each other's exhaustion." },
  { npc_a_id: "alex", npc_b_id: "sasha", trust: 0.5, respect: 0.52, vibe: 0.5, archetype_affinity_prior: 0.45,
    notes: "Minimal contact; quiet mutual respect for each other's discipline." },
  { npc_a_id: "alex", npc_b_id: "theo", trust: 0.51, respect: 0.5, vibe: 0.52, archetype_affinity_prior: 0.55,
    notes: "Two gentle, conscientious people who'd get along easily if they crossed paths." },

  // ── ben ───────────────────────────────────────────────────────────────────
  { npc_a_id: "ben", npc_b_id: "dj", trust: 0.5, respect: 0.52, vibe: 0.53, archetype_affinity_prior: 0.3,
    notes: "Ben, who reads everyone, would delight in DJ's hidden geopolitics depth." },
  { npc_a_id: "ben", npc_b_id: "eliza", trust: 0.5, respect: 0.53, vibe: 0.55, archetype_affinity_prior: 0.3,
    notes: "Cross-cluster, but a likely rapport — Ben's deadpan literacy meets Eliza's sharp wit; they'd trade references." },
  { npc_a_id: "ben", npc_b_id: "jake", trust: 0.5, respect: 0.52, vibe: 0.55, archetype_affinity_prior: 0.7,
    notes: "Ben is wryly amused by Jake the founder-undergrad (Jake once tried to recruit him to Lexora) and secretly roots for him." },
  { npc_a_id: "ben", npc_b_id: "june", trust: 0.5, respect: 0.5, vibe: 0.5, archetype_affinity_prior: 0.3,
    notes: "Cordial; Ben's warmth could thaw June's reserve over time." },
  { npc_a_id: "ben", npc_b_id: "marcus", trust: 0.49, respect: 0.47, vibe: 0.5, archetype_affinity_prior: 0.55,
    notes: "Ben sees straight through Marcus's enthusiasm act but is too warm to be cruel about it." },
  { npc_a_id: "ben", npc_b_id: "maya", trust: 0.49, respect: 0.48, vibe: 0.5, archetype_affinity_prior: 0.55,
    notes: "Ben would clock Maya's impostor fear under the polish and be quietly gentle about it." },
  { npc_a_id: "ben", npc_b_id: "priya", trust: 0.62, respect: 0.6, vibe: 0.58, archetype_affinity_prior: 0.7,
    notes: "Fellow CS PhDs and each other's person — prickly-affectionate; Ben knows Priya ghostwrites her advisor's tweets and won't let her forget it." },
  { npc_a_id: "ben", npc_b_id: "riya", trust: 0.52, respect: 0.49, vibe: 0.53, archetype_affinity_prior: 0.6,
    notes: "Ben would warmly, wryly try to get Riya to do less — the mentor instinct again." },
  { npc_a_id: "ben", npc_b_id: "sasha", trust: 0.5, respect: 0.52, vibe: 0.5, archetype_affinity_prior: 0.3,
    notes: "Little contact; Ben would respect Sasha's quiet competence." },
  { npc_a_id: "ben", npc_b_id: "theo", trust: 0.58, respect: 0.54, vibe: 0.58, archetype_affinity_prior: 0.6,
    notes: "Ben unofficially mentors Theo — tells him breadth isn't a crime and means it, because Theo reminds him of himself." },

  // ── dj ────────────────────────────────────────────────────────────────────
  { npc_a_id: "dj", npc_b_id: "eliza", trust: 0.47, respect: 0.48, vibe: 0.47, archetype_affinity_prior: 0.3,
    notes: "Different worlds, though Eliza might be surprised by DJ's reading." },
  { npc_a_id: "dj", npc_b_id: "jake", trust: 0.47, respect: 0.48, vibe: 0.47, archetype_affinity_prior: 0.3,
    notes: "Different orbits; cordial if they crossed paths." },
  { npc_a_id: "dj", npc_b_id: "june", trust: 0.47, respect: 0.48, vibe: 0.47, archetype_affinity_prior: 0.3,
    notes: "Different worlds; little overlap." },
  { npc_a_id: "dj", npc_b_id: "marcus", trust: 0.49, respect: 0.5, vibe: 0.5, archetype_affinity_prior: 0.45,
    notes: "Cordial; little depth." },
  { npc_a_id: "dj", npc_b_id: "maya", trust: 0.5, respect: 0.54, vibe: 0.52, archetype_affinity_prior: 0.45,
    notes: "Clashed in an IR discussion section; Maya was thrown by how well-read DJ is and recalibrated — now half-respect, half-rivalry, a real spark." },
  { npc_a_id: "dj", npc_b_id: "priya", trust: 0.47, respect: 0.48, vibe: 0.46, archetype_affinity_prior: 0.3,
    notes: "Different worlds; Priya would underestimate DJ until she heard him think." },
  { npc_a_id: "dj", npc_b_id: "riya", trust: 0.5, respect: 0.5, vibe: 0.5, archetype_affinity_prior: 0.45,
    notes: "Little overlap." },
  { npc_a_id: "dj", npc_b_id: "sasha", trust: 0.54, respect: 0.56, vibe: 0.54, archetype_affinity_prior: 0.7,
    notes: "Fellow varsity athletes — DJ respects how Sasha thrives academically and doesn't fully join the team's resentment of her (though it stings); she's grateful he treats her normally (asymmetric: her wariness vs his ease)." },
  { npc_a_id: "dj", npc_b_id: "theo", trust: 0.5, respect: 0.5, vibe: 0.5, archetype_affinity_prior: 0.45,
    notes: "Minimal contact; amiable if they met." },

  // ── eliza ─────────────────────────────────────────────────────────────────
  { npc_a_id: "eliza", npc_b_id: "jake", trust: 0.45, respect: 0.46, vibe: 0.42, archetype_affinity_prior: 0.3,
    notes: "Two-cultures gap; Eliza is allergic to Jake's hype-speak, granting only that he at least makes things." },
  { npc_a_id: "eliza", npc_b_id: "june", trust: 0.62, respect: 0.62, vibe: 0.62, archetype_affinity_prior: 0.75,
    notes: "Closest friends — they trade brutal, useful critique and each is the one whose taste the other fully trusts." },
  { npc_a_id: "eliza", npc_b_id: "marcus", trust: 0.44, respect: 0.4, vibe: 0.4, archetype_affinity_prior: 0.4,
    notes: "Eliza finds Marcus a beautifully-dressed careerist void and enjoys puncturing him at parties." },
  { npc_a_id: "eliza", npc_b_id: "maya", trust: 0.46, respect: 0.5, vibe: 0.45, archetype_affinity_prior: 0.4,
    notes: "Maya is privately intimidated by Eliza's effortless, unperformed sharpness and over-prepares around her; Eliza is unbothered, mildly dismissive of the polish (asymmetric)." },
  { npc_a_id: "eliza", npc_b_id: "priya", trust: 0.48, respect: 0.55, vibe: 0.47, archetype_affinity_prior: 0.3,
    notes: "Cross-cluster, but two formidably sharp minds who'd respect each other's rigor while clashing on culture." },
  { npc_a_id: "eliza", npc_b_id: "riya", trust: 0.47, respect: 0.46, vibe: 0.46, archetype_affinity_prior: 0.6,
    notes: "Eliza would gently disdain Riya's achievement-collecting as the opposite of a real inner life." },
  { npc_a_id: "eliza", npc_b_id: "sasha", trust: 0.47, respect: 0.49, vibe: 0.47, archetype_affinity_prior: 0.3,
    notes: "Little contact." },
  { npc_a_id: "eliza", npc_b_id: "theo", trust: 0.52, respect: 0.54, vibe: 0.5, archetype_affinity_prior: 0.6,
    notes: "Theo is the one who knows Eliza secretly loved CS106B; she's prickly with him precisely because he proves you can belong to both worlds (asymmetric prickliness)." },

  // ── jake ──────────────────────────────────────────────────────────────────
  { npc_a_id: "jake", npc_b_id: "june", trust: 0.47, respect: 0.48, vibe: 0.46, archetype_affinity_prior: 0.3,
    notes: "Different worlds; June would mildly respect that he actually builds." },
  { npc_a_id: "jake", npc_b_id: "marcus", trust: 0.46, respect: 0.56, vibe: 0.46, archetype_affinity_prior: 0.55,
    notes: "The two ambitious CS guys of their year — Marcus envies Jake's genuine conviction (he chose consulting); mutual respect laced with rivalry." },
  { npc_a_id: "jake", npc_b_id: "maya", trust: 0.48, respect: 0.52, vibe: 0.49, archetype_affinity_prior: 0.55,
    notes: "Two performers — Maya's polish vs Jake's hype — in wary mutual recognition." },
  { npc_a_id: "jake", npc_b_id: "priya", trust: 0.42, respect: 0.55, vibe: 0.4, archetype_affinity_prior: 0.7,
    notes: "Jake admires Priya's brilliance and wanted her for Lexora; Priya is cold to him as the archetypal startup-bro, with only a sliver of respect that he actually builds (asymmetric: Jake→Priya respect high, Priya→Jake low)." },
  { npc_a_id: "jake", npc_b_id: "riya", trust: 0.52, respect: 0.55, vibe: 0.53, archetype_affinity_prior: 0.6,
    notes: "Riya orbits Jake's startup world and half-idolizes founders like him; he finds her eager and useful (asymmetric: her admiration > his regard)." },
  { npc_a_id: "jake", npc_b_id: "sasha", trust: 0.47, respect: 0.5, vibe: 0.46, archetype_affinity_prior: 0.3,
    notes: "Little overlap; Jake would respect her discipline if he noticed it." },
  { npc_a_id: "jake", npc_b_id: "theo", trust: 0.5, respect: 0.54, vibe: 0.5, archetype_affinity_prior: 0.6,
    notes: "Same SymSys major; Theo measures himself against Jake's certainty and feels like a fraud beside him (asymmetric: Jake barely clocks it)." },

  // ── june ──────────────────────────────────────────────────────────────────
  { npc_a_id: "june", npc_b_id: "marcus", trust: 0.46, respect: 0.45, vibe: 0.45, archetype_affinity_prior: 0.4,
    notes: "June quietly dismisses Marcus's polished careerism; little common ground." },
  { npc_a_id: "june", npc_b_id: "maya", trust: 0.48, respect: 0.49, vibe: 0.48, archetype_affinity_prior: 0.4,
    notes: "Little overlap; June is indifferent to Maya's performance." },
  { npc_a_id: "june", npc_b_id: "priya", trust: 0.48, respect: 0.52, vibe: 0.47, archetype_affinity_prior: 0.3,
    notes: "Little contact, but a quiet kinship of rigor — both contemptuous of dilettantes." },
  { npc_a_id: "june", npc_b_id: "riya", trust: 0.47, respect: 0.46, vibe: 0.45, archetype_affinity_prior: 0.6,
    notes: "June privately judges Riya's résumé-collecting as the opposite of focused practice — and is a little envious Riya seems to suffer less (asymmetric: Riya largely unaware)." },
  { npc_a_id: "june", npc_b_id: "sasha", trust: 0.5, respect: 0.51, vibe: 0.52, archetype_affinity_prior: 0.3,
    notes: "An academic-side friendship — June has no idea how elite a swimmer Sasha is, which is exactly how Sasha keeps it (asymmetric secret)." },
  { npc_a_id: "june", npc_b_id: "theo", trust: 0.54, respect: 0.53, vibe: 0.55, archetype_affinity_prior: 0.6,
    notes: "June likes Theo because he actually looks at her work and asks about it instead of complimenting it." },

  // ── marcus ────────────────────────────────────────────────────────────────
  { npc_a_id: "marcus", npc_b_id: "maya", trust: 0.5, respect: 0.52, vibe: 0.52, archetype_affinity_prior: 0.6,
    notes: "Two pre-professional performers who recognize the act in each other — easy rapport, latent rivalry." },
  { npc_a_id: "marcus", npc_b_id: "priya", trust: 0.46, respect: 0.44, vibe: 0.44, archetype_affinity_prior: 0.55,
    notes: "Priya quietly disdains Marcus as exactly the polished careerism she has no use for." },
  { npc_a_id: "marcus", npc_b_id: "riya", trust: 0.55, respect: 0.52, vibe: 0.55, archetype_affinity_prior: 0.55,
    notes: "Marcus 'mentors' Riya through BASES and recruiting; she takes his advice as gospel, not seeing he's at least as lost as she is (warm, asymmetric)." },
  { npc_a_id: "marcus", npc_b_id: "sasha", trust: 0.49, respect: 0.51, vibe: 0.5, archetype_affinity_prior: 0.45,
    notes: "Marcus admires the put-together image Sasha embodies and he only performs." },
  { npc_a_id: "marcus", npc_b_id: "theo", trust: 0.5, respect: 0.5, vibe: 0.5, archetype_affinity_prior: 0.55,
    notes: "Minimal contact; amiable." },

  // ── maya ──────────────────────────────────────────────────────────────────
  { npc_a_id: "maya", npc_b_id: "priya", trust: 0.46, respect: 0.45, vibe: 0.43, archetype_affinity_prior: 0.55,
    notes: "Priya sees past Maya's debate-polish to the thin substance under it; Maya would find Priya terrifying (asymmetric)." },
  { npc_a_id: "maya", npc_b_id: "riya", trust: 0.51, respect: 0.51, vibe: 0.52, archetype_affinity_prior: 0.55,
    notes: "Two high-output strivers; easy alliance and mutual recognition." },
  { npc_a_id: "maya", npc_b_id: "sasha", trust: 0.49, respect: 0.51, vibe: 0.5, archetype_affinity_prior: 0.45,
    notes: "Little contact; Maya would envy Sasha's effortless-seeming poise." },
  { npc_a_id: "maya", npc_b_id: "theo", trust: 0.5, respect: 0.5, vibe: 0.5, archetype_affinity_prior: 0.55,
    notes: "Minimal contact; opposite styles (her polish, his hedging)." },

  // ── priya ─────────────────────────────────────────────────────────────────
  { npc_a_id: "priya", npc_b_id: "riya", trust: 0.47, respect: 0.46, vibe: 0.46, archetype_affinity_prior: 0.6,
    notes: "Priya would read Riya's six-startups energy as unfocused noise; Riya would be intimidated." },
  { npc_a_id: "priya", npc_b_id: "sasha", trust: 0.48, respect: 0.52, vibe: 0.47, archetype_affinity_prior: 0.3,
    notes: "Little contact, but a mutual, unspoken respect for discipline if they met." },
  { npc_a_id: "priya", npc_b_id: "theo", trust: 0.5, respect: 0.54, vibe: 0.5, archetype_affinity_prior: 0.6,
    notes: "Priya TA'd Theo's CS229 and finds him smarter than he believes; Theo is intimidated and desperate for her approval (asymmetric)." },

  // ── riya ──────────────────────────────────────────────────────────────────
  { npc_a_id: "riya", npc_b_id: "sasha", trust: 0.55, respect: 0.52, vibe: 0.55, archetype_affinity_prior: 0.45,
    notes: "Floormates and secret mirrors — both running on the same fumes and pretending not to; Sasha's poise makes Riya's overcommitment look frantic by comparison." },
  { npc_a_id: "riya", npc_b_id: "theo", trust: 0.52, respect: 0.5, vibe: 0.52, archetype_affinity_prior: 0.6,
    notes: "Two students still figuring out who they are — Theo's belonging question, Riya's what-do-I-even-like — a quiet kinship." },

  // ── sasha ─────────────────────────────────────────────────────────────────
  { npc_a_id: "sasha", npc_b_id: "theo", trust: 0.51, respect: 0.5, vibe: 0.5, archetype_affinity_prior: 0.45,
    notes: "No direct tie, but kindred in quietly belonging to no single world." },
];
