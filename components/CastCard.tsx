"use client";

import Link from "next/link";
import { useState } from "react";
import { SpriteStage, Meters, BondPips, bondLevel } from "@/components/pixel";

export interface CastMember {
  id: string;
  name: string;
  archetype: string;
  voiceTag: string;
  scores: { trust: number; respect: number; vibe: number } | null;
  conversationCount: number;
}

/** A cast-grid card. Pixel sprite on a tinted tile that walks on hover, name +
 *  archetype + bond pips, voice tag, and Trust/Respect/Vibe meters once met. */
export default function CastCard({ npc }: { npc: CastMember }) {
  const [hover, setHover] = useState(false);
  const met = npc.scores != null;
  const lvl = met
    ? bondLevel(npc.scores!.trust, npc.scores!.respect, npc.scores!.vibe)
    : { n: 1, label: "New" };

  return (
    <Link
      href={`/chat/${npc.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        textAlign: "left",
        background: "var(--panel)",
        border: "2px solid " + (hover ? "var(--accent)" : "var(--line-2)"),
        borderRadius: "var(--r)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxShadow: "var(--shadow-card)",
        transform: hover ? "translateY(-4px)" : "none",
        transition: "transform .16s cubic-bezier(.2,.8,.2,1), border-color .16s",
        color: "inherit",
        textDecoration: "none",
      }}
    >
      <div style={{ display: "flex", gap: 13 }}>
        <div style={{ flex: "0 0 auto" }}>
          <SpriteStage id={npc.id} scale={4.4} pad={10} walk={hover} round={14} />
        </div>
        <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
          <span className="px" style={{ fontSize: 15, lineHeight: 1.15, display: "block" }}>
            {npc.name}
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              margin: "3px 0 7px",
            }}
          >
            <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{npc.archetype}</span>
            {met && <BondPips n={lvl.n} />}
          </div>
          {npc.voiceTag && (
            <div style={{ fontSize: 12.5, fontStyle: "italic", color: "var(--ink-2)", lineHeight: 1.4 }}>
              &ldquo;{npc.voiceTag}&rdquo;
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: "auto" }}>
        {met ? (
          <Meters scores={npc.scores!} />
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", padding: "6px 0", fontStyle: "italic" }}>
            You haven&rsquo;t met yet.
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 11,
          }}
        >
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
            {npc.conversationCount > 0
              ? `${npc.conversationCount} conversation${npc.conversationCount === 1 ? "" : "s"}`
              : "no conversations yet"}
          </span>
          <span
            className="px"
            style={{ fontSize: 12, color: "var(--accent)", opacity: hover ? 1 : 0.55, transition: "opacity .16s" }}
          >
            {met ? "Continue →" : "Say hi →"}
          </span>
        </div>
      </div>
    </Link>
  );
}
