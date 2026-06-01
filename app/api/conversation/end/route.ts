import { NextResponse } from "next/server";
import { endConversation } from "@/lib/conversationEnd";

export const runtime = "nodejs";

interface EndBody {
  conversation_id: string;
}

/**
 * End-of-conversation hook. Currently called via navigator.sendBeacon when the
 * user navigates away or closes the tab; also invoked internally by
 * /api/advance-day for any open conversations the player has.
 *
 * Idempotent — see lib/conversationEnd.ts.
 */
export async function POST(req: Request) {
  let body: EndBody;
  try {
    body = (await req.json()) as EndBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { conversation_id } = body ?? {};
  if (!conversation_id) {
    return NextResponse.json(
      { error: "conversation_id is required" },
      { status: 400 },
    );
  }

  try {
    const result = await endConversation(conversation_id);
    if (result.status === "not-found") {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    return NextResponse.json({
      status: result.status,
      scores: result.scores,
      deltas: result.deltas
        ? {
            delta_trust: result.deltas.delta_trust,
            delta_respect: result.deltas.delta_respect,
            delta_vibe: result.deltas.delta_vibe,
          }
        : null,
      reasoning: result.deltas?.reasoning ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to end conversation: ${msg}` },
      { status: 500 },
    );
  }
}
