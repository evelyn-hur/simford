import "server-only";

/**
 * Baseline (ablation) mode for evaluation runs.
 *
 * In baseline mode the chat API serves a STATELESS NPC: it still uses the NPC's
 * identity prompt and the current conversation's in-session messages, but it
 * does NOT retrieve from memory_stream, does NOT inject relationship state, and
 * does NOT inject off-screen inter-NPC "social context" — i.e. nothing that
 * carries over between sessions. Background memory writes and the
 * end-of-conversation relationship judge still run, so an A/B run can compare
 * what the stateful machinery WOULD have surfaced against the stateless reply
 * the player actually saw.
 *
 * Resolution order (designed to be trivial to flip per request for eval runs):
 *   1. The `X-Eval-Mode` request header wins when present:
 *        "baseline"                    -> baseline ON
 *        "full" | "normal" | "default" -> baseline OFF (overrides the env var)
 *   2. Otherwise fall back to the BASELINE_MODE env var ("true" -> ON).
 *
 * So a single global `BASELINE_MODE=true` flips an entire deployment, while an
 * eval harness can override either direction on a per-request basis with one
 * header — no redeploy, no restart.
 */
export const EVAL_MODE_HEADER = "x-eval-mode";

/** Whether the BASELINE_MODE env var is set (the deployment-wide default). */
export function isBaselineModeEnv(): boolean {
  return process.env.BASELINE_MODE === "true";
}

/** Resolve baseline mode for a single request — the header overrides the env. */
export function isBaselineMode(req: Request): boolean {
  const header = req.headers.get(EVAL_MODE_HEADER)?.trim().toLowerCase();
  if (header === "baseline") return true;
  if (header === "full" || header === "normal" || header === "default") {
    return false;
  }
  return isBaselineModeEnv();
}
