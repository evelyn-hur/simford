"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage } from "@/lib/conversations";
import { weekOfQuarter } from "@/lib/gameTime";
import MemoryPanel, { type MemoryUsed } from "@/components/MemoryPanel";
import RelationshipPanel, {
  type RelationshipScores,
} from "@/components/RelationshipPanel";
import { Sprite, GameButton } from "@/components/pixel";

/** Small bottom-aligned sprite bust beside an NPC bubble. */
function MsgAvatar({ npcId }: { npcId: string }) {
  return (
    <div
      style={{
        flex: "0 0 auto",
        width: 34,
        height: 40,
        borderRadius: 9,
        background: "var(--panel-3)",
        border: "1px solid var(--line)",
        overflow: "hidden",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <Sprite id={npcId} scale={1.6} />
    </div>
  );
}

/** "NPC is typing" — sprite bust + three bobbing dots. */
function TypingBubble({ npcId }: { npcId: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
      <MsgAvatar npcId={npcId} />
      <div
        style={{
          background: "var(--panel-2)",
          border: "1.5px solid var(--line)",
          borderRadius: 14,
          borderBottomLeftRadius: 5,
          padding: "11px 14px",
          display: "inline-flex",
          gap: 5,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--ink-3)",
              animation: "floaty .9s ease-in-out infinite",
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) 320px",
        gap: 18,
        alignItems: "start",
        marginTop: 14,
      }}
    >
      {/* Main chat panel */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 480,
          height: "calc(100vh - 210px)",
          background: "var(--panel)",
          border: "2px solid var(--line-2)",
          borderRadius: "var(--r)",
          boxShadow: "var(--shadow-card)",
          overflow: "hidden",
        }}
      >
        {/* Thread */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "18px 18px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {messages.length === 0 && (
            <p
              style={{
                textAlign: "center",
                color: "var(--ink-3)",
                fontSize: 13,
                fontStyle: "italic",
                padding: "44px 0",
              }}
            >
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
            const mine = m.role === "player";
            // Sprite bust only on the first of a consecutive NPC run.
            const showAvatar =
              !mine && (showDivider || prev == null || prev.role !== "npc");

            return (
              <div key={i}>
                {showDivider && m.inGameDay != null && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      margin: "8px 0",
                      color: "var(--ink-3)",
                      fontSize: 11,
                    }}
                  >
                    <div style={{ height: 2, flex: 1, background: "var(--line)", borderRadius: 2 }} />
                    <span className="px" style={{ whiteSpace: "nowrap", letterSpacing: 0.4 }}>
                      Day {m.inGameDay} · Week {weekOfQuarter(m.inGameDay)}
                    </span>
                    <div style={{ height: 2, flex: 1, background: "var(--line)", borderRadius: 2 }} />
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    justifyContent: mine ? "flex-end" : "flex-start",
                    alignItems: "flex-end",
                    gap: 8,
                  }}
                >
                  {!mine &&
                    (showAvatar ? (
                      <MsgAvatar npcId={npcId} />
                    ) : (
                      <div style={{ width: 34, flex: "0 0 auto" }} />
                    ))}
                  <div
                    style={{
                      maxWidth: "76%",
                      whiteSpace: "pre-wrap",
                      fontSize: 13.5,
                      lineHeight: 1.5,
                      padding: "10px 14px",
                      borderRadius: 15,
                      ...(mine
                        ? {
                            background: "var(--accent)",
                            color: "var(--accent-ink)",
                            borderBottomRightRadius: 5,
                          }
                        : {
                            background: "var(--panel-2)",
                            color: "var(--ink)",
                            border: "1.5px solid var(--line)",
                            borderBottomLeftRadius: 5,
                          }),
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              </div>
            );
          })}

          {loading && <TypingBubble npcId={npcId} />}

          <div ref={bottomRef} />
        </div>

        {error && (
          <div
            style={{
              margin: "0 14px 8px",
              background: "var(--accent-soft)",
              color: "var(--accent-2)",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {/* Composer */}
        <div
          style={{
            borderTop: "2px solid var(--line)",
            background: "var(--panel-2)",
            padding: "12px 14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={`Message ${npcName}…`}
              style={{
                flex: 1,
                resize: "none",
                maxHeight: 160,
                fontFamily: "var(--font-body), sans-serif",
                fontSize: 14,
                lineHeight: 1.45,
                color: "var(--ink)",
                background: "var(--panel)",
                border: "2px solid var(--line-2)",
                borderRadius: 12,
                padding: "10px 14px",
                outline: "none",
              }}
            />
            <GameButton primary onClick={() => void send()} disabled={loading || !input.trim()}>
              Send
            </GameButton>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button
              onClick={() => void sayGoodbye()}
              disabled={sayingGoodbye || loading || sendsThisConversation === 0}
              title="End this conversation and update the relationship"
              className="px text-[11.5px] text-ink-3 transition hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-ink-3"
            >
              {sayingGoodbye ? "Saying goodbye…" : "Say goodbye 👋"}
            </button>
          </div>
        </div>
      </div>

      {/* Right rail */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          height: "calc(100vh - 210px)",
          minHeight: 480,
          overflowY: "auto",
        }}
      >
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
