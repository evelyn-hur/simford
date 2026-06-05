"use client";

import { useState } from "react";

/**
 * Restart-the-game control: opens a confirmation modal, then POSTs /api/restart
 * (which wipes play state but preserves the seeded NPCs, relationship priors, and
 * inter-NPC events). Reloads to "/" so every view reflects the fresh Day-1 state.
 */
export default function RestartButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restart() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/restart", { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Restart failed");
      window.location.assign("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restart failed");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-neutral-500 transition hover:text-cardinal"
      >
        Restart
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restart-title"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="restart-title"
              className="text-base font-semibold text-neutral-900"
            >
              Are you sure you want to restart?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              This wipes your conversations, memories, and relationship scores and
              resets the clock to Day&nbsp;1. The seeded characters, their
              relationship priors, and the off-screen events are kept.
            </p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={restart}
                disabled={busy}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? "Restarting…" : "Yes, restart"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
