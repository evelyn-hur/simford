import { readFileSync } from "node:fs";
import { join } from "node:path";
import EvalRateForm, { type PoolItem } from "@/components/EvalRateForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Rate the responses — Simford study",
  description: "A short blind rating study of AI character responses.",
  robots: { index: false, follow: false },
};

/** Read the blind, mode-stripped rating pool. The de-blinding map
 *  (answer-key.json) is deliberately NOT read here, so mode never reaches the
 *  client. */
function loadPool(): PoolItem[] {
  try {
    const raw = readFileSync(join(process.cwd(), "evaluation", "external", "pool.json"), "utf8");
    const parsed = JSON.parse(raw) as { items?: PoolItem[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export default function EvalRatePage() {
  return <EvalRateForm items={loadPool()} />;
}
