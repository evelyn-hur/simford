import { NextResponse } from "next/server";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Needs the Node runtime (filesystem write) and must never be statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS_DIR = join(process.cwd(), "evaluation", "results");

interface IncomingRating {
  id: string;
  authentic: number;
  voice: number;
  off?: string;
}

function clamp15(n: unknown): number | null {
  const v = Math.round(Number(n));
  return Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
}

/**
 * Save one external rater's submission for the /eval-rate survey to
 * evaluation/results/external_ratings_<name>.json. Submissions are appended, so a
 * rater can come back / resubmit without clobbering an earlier sitting. Mode
 * (system vs baseline) is intentionally NOT part of the payload — the de-blinding
 * map lives only in evaluation/external/answer-key.json.
 */
export async function POST(req: Request) {
  let body: { rater?: string; ratings?: IncomingRating[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rater = (body.rater ?? "").trim();
  if (!rater) {
    return NextResponse.json({ error: "Please enter your name or identifier." }, { status: 400 });
  }

  const incoming = Array.isArray(body.ratings) ? body.ratings : [];
  const clean = incoming
    .filter((r) => r && typeof r.id === "string")
    .map((r) => ({
      id: r.id,
      authentic: clamp15(r.authentic),
      voice: clamp15(r.voice),
      off: typeof r.off === "string" ? r.off.trim().slice(0, 2000) : "",
    }))
    .filter((r): r is { id: string; authentic: number; voice: number; off: string } =>
      r.authentic !== null && r.voice !== null,
    );

  if (clean.length === 0) {
    return NextResponse.json(
      { error: "No valid ratings — each response needs a 1–5 on both scales." },
      { status: 400 },
    );
  }

  const safe = rater.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase() || "anon";
  const path = join(RESULTS_DIR, `external_ratings_${safe}.json`);

  let file: { rater: string; submissions: unknown[] } = { rater, submissions: [] };
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed && Array.isArray(parsed.submissions)) file = parsed;
    } catch {
      /* corrupt file — start fresh */
    }
  }
  file.rater = rater;
  file.submissions.push({
    submittedAt: new Date().toISOString(),
    count: clean.length,
    ratings: clean,
  });

  try {
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(path, JSON.stringify(file, null, 2));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save ratings." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "ok",
    saved: clean.length,
    file: `evaluation/results/external_ratings_${safe}.json`,
  });
}
