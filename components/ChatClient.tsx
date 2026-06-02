"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage } from "@/lib/conversations";
import { weekOfQuarter } from "@/lib/gameTime";
import MemoryPanel, { type MemoryUsed } from "@/components/MemoryPanel";
import RelationshipPanel, {
  type RelationshipScores,
} from "@/components/RelationshipPanel";

export default function ChatClient({
  npcId,
  npcName,
  conversationId,
  initialMessages,
  initialScores,
}: {
  npcId: string;
  npcName: string;
  conversationId: string;
  initialMessages: ChatMessage[];
  initialScores: RelationshipScores;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memoriesUsed, setMemoriesUsed] = useState<MemoryUsed[]>([]);
  const [scores, setScores] = useState<RelationshipScores>(initialScores);
  const [turnId, setTurnId] = useState(0);
  const [sayingGoodbye, setSayingGoodbye] = useState(false);
  // Bumped after a goodbye so the relationship panel surfaces the new event.
  const [relRefreshKey, setRelRefreshKey] = useState(0);
  // Messages sent into the CURRENT conversation this session. Resets when the
  // conversation rotates (after a goodbye), so "Say goodbye" is only enabled
  // once there's actually something in this conversation to judge.
  const [sendsThisConversation, setSendsThisConversation] = useState(0);

  // Ref (not state) so the safety-net effect's closure always reads the latest
  // "has the conversation been ended yet" value. There is no explicit end
  // button — `/api/conversation/end` is fired only by the safety net (route
  // change / tab close) and indirectly by /api/advance-day.
  const hasEndedRef = useRef(false);
  // Counts how many cleanups have fired. Used to skip the very first cleanup
  // in dev, which is React 18 strict mode's `setup → cleanup → setup` test
  // run on initial mount — that artifact would otherwise consume the safety
  // net and silently disable the real refresh/navigate triggers.
  const cleanupCountRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // "Say goodbye": explicitly end + judge the current conversation, then start
  // fresh. Ends the conversation server-side (the same path the navigate-away
  // safety net uses), reflects the new scores immediately (the meters animate
  // via RelationshipPanel's flash effect), nudges the relationship panel to
  // surface the new event, marks this conversation ended so the rotation below
  // doesn't re-beacon it, and re-runs the server component to get a fresh
  // conversation id for the next chat. Client state (the message thread) is
  // preserved across the refresh.
  const sayGoodbye = useCallback(async () => {
    if (sayingGoodbye || loading || sendsThisConversation === 0) return;
    setSayingGoodbye(true);
    try {
      const res = await fetch("/api/conversation/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = (await res.json()) as {
        status?: string;
        scores?: RelationshipScores;
      };
      if (res.ok && data.scores) setScores(data.scores);
      setRelRefreshKey((k) => k + 1);
      hasEndedRef.current = true;
      router.refresh();
    } catch {
      // Non-critical; the safety net will still judge on navigate-away.
    } finally {
      setSayingGoodbye(false);
    }
  }, [sayingGoodbye, loading, sendsThisConversation, conversationId, router]);

  // A new conversation id means a fresh session — nothing sent into it yet.
  useEffect(() => {
    setSendsThisConversation(0);
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setError(null);
    setInput("");
    // Optimistic append (no inGameDay yet — server fills it in on response).
    setMessages((prev) => [
      ...prev,
      { role: "player", content: text, conversationId },
    ]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          npc_id: npcId,
          conversation_id: conversationId,
          message: text,
        }),
      });

      const data = (await res.json()) as {
        response?: string;
        reply?: string;
        memoriesUsed?: MemoryUsed[];
        relationshipScores?: RelationshipScores;
        inGameDay?: number;
        error?: string;
      };

      const npcText = data.response ?? data.reply;
      if (!res.ok || !npcText) {
        throw new Error(data.error ?? "Something went wrong");
      }

      // Backfill the optimistic player message + append the NPC reply, both
      // stamped with the in-game day the server used (so dividers render).
      setMessages((prev) => {
        const next = prev.slice();
        const last = next.length - 1;
        if (last >= 0 && next[last].role === "player") {
          next[last] = {
            ...next[last],
            inGameDay: data.inGameDay ?? null,
          };
        }
        next.push({
          role: "npc",
          content: npcText,
          conversationId,
          inGameDay: data.inGameDay ?? null,
        });
        return next;
      });
      setMemoriesUsed(data.memoriesUsed ?? []);
      if (data.relationshipScores) setScores(data.relationshipScores);
      setTurnId((t) => t + 1);
      setSendsThisConversation((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  // Navigation safety net: route change (cleanup) and tab close (beforeunload)
  // both fire /api/conversation/end via navigator.sendBeacon so the request
  // reliably reaches the server during page teardown. Idempotent at the
  // server, so a stray duplicate after /api/advance-day already closed the
  // conversation is harmless.
  useEffect(() => {
    // A new conversation id means a fresh, not-yet-ended session — re-arm the
    // safety net (it may have been disarmed by a manual "wrap up & update",
    // which rotates the conversation via router.refresh()).
    hasEndedRef.current = false;
    const fireEndBeacon = () => {
      if (hasEndedRef.current) return;
      hasEndedRef.current = true;
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob(
          [JSON.stringify({ conversation_id: conversationId })],
          { type: "application/json" },
        );
        navigator.sendBeacon("/api/conversation/end", blob);
      }
    };
    window.addEventListener("beforeunload", fireEndBeacon);
    return () => {
      window.removeEventListener("beforeunload", fireEndBeacon);
      cleanupCountRef.current += 1;
      // React 18 strict mode (always on in Next.js dev) runs every effect as
      // `setup → cleanup → setup` on the initial mount, as a test of the
      // cleanup. Without this guard, that first cleanup would (a) fire the
      // beacon for the empty just-created conversation, and (b) flip
      // hasEndedRef so the REAL refresh/navigate triggers silently no-op.
      // Skip only that first cleanup, only in dev.
      if (
        cleanupCountRef.current === 1 &&
        process.env.NODE_ENV === "development"
      ) {
        return;
      }
      // Client-side route change / component unmount also counts as leaving.
      fireEndBeacon();
    };
  }, [conversationId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 pt-4 lg:flex-row">
      {/* Chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Message list */}
        <div className="flex-1 space-y-4 overflow-y-auto px-1 py-6">
          {messages.length === 0 && (
            <p className="py-12 text-center text-sm text-neutral-400">
              Say hello to start the conversation.
            </p>
          )}

          {messages.map((m, i) => {
            // iMessage-style divider: show above the first message that
            // carries a day, and any time conversation_id or in_game_day
            // changes between adjacent messages.
            const prev = i > 0 ? messages[i - 1] : null;
            const dayChanged =
              prev != null &&
              (prev.inGameDay ?? null) !== (m.inGameDay ?? null);
            const convChanged =
              prev != null &&
              (prev.conversationId ?? null) !== (m.conversationId ?? null);
            const showDivider =
              ((i === 0 && m.inGameDay != null) ||
                dayChanged ||
                convChanged) &&
              m.inGameDay != null;

            return (
              <div key={i}>
                {showDivider && m.inGameDay != null && (
                  <div className="my-4 flex items-center gap-3 text-[11px] text-neutral-400">
                    <div className="h-px flex-1 bg-neutral-200" />
                    <span className="whitespace-nowrap">
                      Day {m.inGameDay} · Week {weekOfQuarter(m.inGameDay)} of
                      Fall Quarter
                    </span>
                    <div className="h-px flex-1 bg-neutral-200" />
                  </div>
                )}
                <div
                  className={`flex ${
                    m.role === "player" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.role === "player"
                        ? "bg-neutral-900 text-white"
                        : "border border-neutral-200 bg-white text-neutral-800 shadow-sm"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-400 shadow-sm">
                <span className="inline-flex gap-1">
                  <span className="animate-pulse">●</span>
                  <span className="animate-pulse [animation-delay:150ms]">
                    ●
                  </span>
                  <span className="animate-pulse [animation-delay:300ms]">
                    ●
                  </span>
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {error && (
          <p className="mb-2 rounded-lg bg-cardinal/5 px-3 py-2 text-sm text-cardinal">
            {error}
          </p>
        )}

        {/* Composer */}
        <div className="border-t border-neutral-200 pt-4">
          <div className="mb-2 flex justify-end">
            <button
              onClick={() => void sayGoodbye()}
              disabled={sayingGoodbye || loading || sendsThisConversation === 0}
              title="End this conversation and update the relationship"
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-cardinal disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-500"
            >
              {sayingGoodbye ? "Saying goodbye…" : "Say goodbye 👋"}
            </button>
          </div>
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Type a message…"
              className="max-h-40 flex-1 resize-none rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-cardinal/40 focus:ring-2 focus:ring-cardinal/10"
            />
            <button
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              className="rounded-xl bg-cardinal px-5 py-3 text-sm font-medium text-white transition hover:bg-cardinal/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Right column: stacked panels */}
      <div className="flex shrink-0 flex-col gap-4 lg:w-80">
        <MemoryPanel npcName={npcName} memories={memoriesUsed} />
        <RelationshipPanel
          npcName={npcName}
          npcId={npcId}
          conversationId={conversationId}
          scores={scores}
          turnId={turnId}
          refreshKey={relRefreshKey}
        />
      </div>
    </div>
  );
}
