import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/server";
import NpcAvatar from "@/components/NpcAvatar";

export const dynamic = "force-dynamic";

interface NpcCard {
  id: string;
  name: string;
  archetype: string;
}

async function getNpcs(): Promise<NpcCard[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("npcs")
    .select("id, name, archetype")
    .order("name", { ascending: true });

  if (error) throw new Error(`Failed to load NPCs: ${error.message}`);
  return data ?? [];
}

export default async function Home() {
  const npcs = await getNpcs();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Simford
        </h1>
        <p className="max-w-prose text-neutral-600">
          Pick someone to talk to. Conversations are remembered.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {npcs.map((npc) => (
          <Link
            key={npc.id}
            href={`/chat/${npc.id}`}
            className="group flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-cardinal/30 hover:shadow-md"
          >
            <NpcAvatar name={npc.name} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-medium text-neutral-900">
                {npc.name}
              </p>
              <p className="truncate text-sm text-neutral-500">
                {npc.archetype}
              </p>
              <span className="mt-2 inline-block text-sm font-medium text-cardinal opacity-0 transition group-hover:opacity-100">
                Start a conversation →
              </span>
            </div>
          </Link>
        ))}

        {npcs.length === 0 && (
          <p className="text-neutral-500">
            No NPCs yet. Run{" "}
            <code className="rounded bg-neutral-100 px-1">
              npx tsx scripts/seed-npcs.ts
            </code>
            .
          </p>
        )}
      </div>
    </div>
  );
}
