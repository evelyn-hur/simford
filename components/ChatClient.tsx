"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/conversations";
import MemoryPanel, { type MemoryUsed } from "@/components/MemoryPanel";

export default function ChatClient({
  npcId,
  npcName,
  conversationId,
  initialMessages,
}: {
  npcId: string;
  npcName: string;
  conversationId: string;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memoriesUsed, setMemoriesUsed] = useState<MemoryUsed[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setError(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "player", content: text }]);
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
        error?: string;
      };

      const npcText = data.response ?? data.reply;
      if (!res.ok || !npcText) {
        throw new Error(data.error ?? "Something went wrong");
      }

      setMessages((prev) => [...prev, { role: "npc", content: npcText }]);
      setMemoriesUsed(data.memoriesUsed ?? []);
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

        {messages.map((m, i) => (
          <div
            key={i}
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
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-400 shadow-sm">
              <span className="inline-flex gap-1">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse [animation-delay:150ms]">●</span>
                <span className="animate-pulse [animation-delay:300ms]">●</span>
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
      <div className="flex items-end gap-3 border-t border-neutral-200 pt-4">
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

      <MemoryPanel npcName={npcName} memories={memoriesUsed} />
    </div>
  );
}
