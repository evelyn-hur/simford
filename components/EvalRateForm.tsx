"use client";

import { useMemo, useState, type CSSProperties } from "react";

export interface PoolItem {
  id: string;
  npc: string;
  npcName: string;
  playerMessage: string;
  npcResponse: string;
}

type Scores = { authentic?: number; voice?: number; off: string };

const SCALE = [1, 2, 3, 4, 5];

/** One 1–5 Likert row with end anchors. */
function Likert({
  question,
  lowLabel,
  highLabel,
  value,
  onChange,
}: {
  question: string;
  lowLabel: string;
  highLabel: string;
  value: number | undefined;
  onChange: (n: number) => void;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", marginBottom: 7 }}>
        {question}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--ink-3)", width: 78, textAlign: "right" }}>
          {lowLabel}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {SCALE.map((n) => {
            const active = value === n;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(n)}
                className="px"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  fontSize: 15,
                  cursor: "pointer",
                  border: "2px solid " + (active ? "var(--accent-2)" : "var(--line-2)"),
                  background: active ? "var(--accent)" : "var(--panel)",
                  color: active ? "var(--accent-ink)" : "var(--ink-2)",
                  boxShadow: active ? "none" : "0 2px 0 var(--line-2)",
                  transition: "background .12s, color .12s, border-color .12s",
                }}
              >
                {n}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: 11, color: "var(--ink-3)", width: 78 }}>{highLabel}</span>
      </div>
    </div>
  );
}

const panel: CSSProperties = {
  background: "var(--panel)",
  border: "2px solid var(--line-2)",
  borderRadius: "var(--r)",
  boxShadow: "var(--shadow-card)",
};

export default function EvalRateForm({ items }: { items: PoolItem[] }) {
  const [rater, setRater] = useState("");
  const [scores, setScores] = useState<Record<string, Scores>>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [savedFile, setSavedFile] = useState<string | null>(null);

  const set = (id: string, patch: Partial<Scores>) =>
    setScores((s) => {
      const prev: Scores = s[id] ?? { off: "" };
      return { ...s, [id]: { ...prev, ...patch } };
    });

  const ratedCount = useMemo(
    () => items.filter((it) => scores[it.id]?.authentic && scores[it.id]?.voice).length,
    [items, scores],
  );
  const allRated = ratedCount === items.length && items.length > 0;

  async function submit() {
    setMessage(null);
    if (!rater.trim()) {
      setStatus("error");
      setMessage("Please enter your name or an identifier at the top first.");
      return;
    }
    if (!allRated) {
      const missing = items
        .map((it, i) => ({ n: i + 1, ok: !!(scores[it.id]?.authentic && scores[it.id]?.voice) }))
        .filter((x) => !x.ok)
        .map((x) => x.n);
      setStatus("error");
      setMessage(
        `Please give both ratings on every response before submitting. Still missing: #${missing.join(", #")}.`,
      );
      return;
    }
    setStatus("submitting");
    try {
      const res = await fetch("/api/eval-rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rater: rater.trim(),
          ratings: items.map((it) => ({
            id: it.id,
            authentic: scores[it.id]!.authentic,
            voice: scores[it.id]!.voice,
            off: scores[it.id]?.off ?? "",
          })),
        }),
      });
      const data = (await res.json()) as { error?: string; file?: string };
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setSavedFile(data.file ?? null);
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  if (items.length === 0) {
    return (
      <div style={{ ...panel, padding: 24, marginTop: 8 }}>
        <h1 className="px" style={{ fontSize: 22, margin: 0 }}>
          No responses to rate yet
        </h1>
        <p style={{ color: "var(--ink-2)", marginTop: 8 }}>
          The rating pool is empty. Generate it with{" "}
          <code style={{ background: "var(--panel-3)", padding: "1px 6px", borderRadius: 6 }}>
            npx tsx scripts/build-eval-rate-pool.ts
          </code>
          .
        </p>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div style={{ ...panel, padding: 28, marginTop: 8, textAlign: "center" }}>
        <div style={{ fontSize: 34 }} aria-hidden="true">
          🌲
        </div>
        <h1 className="px" style={{ fontSize: 24, margin: "8px 0" }}>
          Thank you!
        </h1>
        <p style={{ color: "var(--ink-2)", margin: 0 }}>
          Your {items.length} ratings were saved. You can close this tab.
        </p>
        {savedFile && (
          <p style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 10 }}>
            Saved to <code>{savedFile}</code>
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 40 }}>
      {/* Intro */}
      <section style={{ ...panel, padding: "24px 26px" }}>
        <div
          className="px"
          style={{ fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--accent)" }}
        >
          Rating study
        </div>
        <h1 className="px" style={{ fontSize: 28, margin: "6px 0 10px", lineHeight: 1.12 }}>
          How real do these characters sound?
        </h1>
        <p style={{ color: "var(--ink-2)", fontSize: 14.5, margin: 0, maxWidth: 640 }}>
          Below are {items.length} short exchanges between a player and an AI character meant to be a
          contemporary <strong>Stanford student</strong>. For each, rate two things on a 1–5 scale
          and (optionally) note anything that felt off. It takes about 5–10 minutes. There are no
          right answers — go with your gut.
        </p>
        <div style={{ marginTop: 16, maxWidth: 360 }}>
          <label
            htmlFor="rater"
            className="px"
            style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--ink-3)" }}
          >
            Your name or identifier
          </label>
          <input
            id="rater"
            value={rater}
            onChange={(e) => setRater(e.target.value)}
            placeholder="e.g. rater-a, or your first name"
            style={{
              display: "block",
              width: "100%",
              marginTop: 6,
              fontSize: 14,
              color: "var(--ink)",
              background: "var(--panel-2)",
              border: "2px solid var(--line-2)",
              borderRadius: 10,
              padding: "9px 13px",
              outline: "none",
            }}
          />
        </div>
      </section>

      {/* Items */}
      {items.map((it, i) => {
        const s = scores[it.id];
        const complete = !!(s?.authentic && s?.voice);
        return (
          <section key={it.id} style={{ ...panel, padding: "20px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span className="px" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                Response {i + 1} of {items.length}
              </span>
              <span
                className="px"
                style={{
                  fontSize: 11,
                  padding: "3px 10px",
                  borderRadius: 20,
                  background: complete ? "var(--accent-soft)" : "var(--panel-3)",
                  color: complete ? "var(--accent-2)" : "var(--ink-3)",
                  border: "1px solid " + (complete ? "var(--accent-2)" : "var(--line)"),
                }}
              >
                {complete ? "✓ rated" : "not rated"}
              </span>
            </div>

            {/* Exchange */}
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div
                  className="px"
                  style={{ fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 3 }}
                >
                  Player
                </div>
                <div style={{ fontSize: 14, color: "var(--ink-2)" }}>{it.playerMessage}</div>
              </div>
              <div>
                <div
                  className="px"
                  style={{ fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 3 }}
                >
                  {it.npcName}
                </div>
                <div
                  style={{
                    fontSize: 14.5,
                    lineHeight: 1.55,
                    color: "var(--ink)",
                    whiteSpace: "pre-wrap",
                    background: "var(--panel-2)",
                    border: "1.5px solid var(--line)",
                    borderRadius: 12,
                    padding: "12px 15px",
                  }}
                >
                  {it.npcResponse}
                </div>
              </div>
            </div>

            <Likert
              question="How much does this sound like a real Stanford student?"
              lowLabel="Not at all"
              highLabel="Definitely"
              value={s?.authentic}
              onChange={(n) => set(it.id, { authentic: n })}
            />
            <Likert
              question="Does this sound like a specific, particular person — or could it be any generic AI?"
              lowLabel="Generic AI"
              highLabel="Distinct person"
              value={s?.voice}
              onChange={(n) => set(it.id, { voice: n })}
            />

            <div style={{ marginTop: 12 }}>
              <label
                style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: 6 }}
              >
                What felt off? <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea
                value={s?.off ?? ""}
                onChange={(e) => set(it.id, { off: e.target.value })}
                rows={2}
                placeholder="Anything that broke the illusion, or that felt especially right…"
                style={{
                  width: "100%",
                  resize: "vertical",
                  fontFamily: "var(--font-body), sans-serif",
                  fontSize: 13.5,
                  color: "var(--ink)",
                  background: "var(--panel-2)",
                  border: "2px solid var(--line-2)",
                  borderRadius: 10,
                  padding: "9px 13px",
                  outline: "none",
                }}
              />
            </div>
          </section>
        );
      })}

      {/* Submit bar */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          ...panel,
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="px tnum" style={{ fontSize: 14, color: allRated ? "var(--vibe)" : "var(--ink-2)" }}>
            {ratedCount}/{items.length} rated
          </span>
          {message && (
            <span style={{ fontSize: 12.5, color: "var(--bad)" }}>{message}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={status === "submitting"}
          className="px"
          style={{
            fontSize: 14,
            padding: "11px 22px",
            borderRadius: 12,
            border: "2px solid var(--accent-2)",
            background: status === "submitting" ? "var(--ink-3)" : "var(--accent)",
            color: "var(--accent-ink)",
            boxShadow: "var(--shadow-btn-accent)",
            cursor: status === "submitting" ? "default" : "pointer",
            opacity: status === "submitting" ? 0.7 : 1,
          }}
        >
          {status === "submitting" ? "Saving…" : "Submit ratings"}
        </button>
      </div>
    </div>
  );
}
