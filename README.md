# Simford

Next.js 14 (App Router) + TypeScript + Tailwind, wired up with Supabase,
Anthropic, and OpenAI (embeddings only) clients.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

## Structure

- `lib/supabase/server.ts` — server Supabase client (+ service-role client)
- `lib/supabase/client.ts` — browser Supabase client
- `lib/anthropic.ts` — Anthropic SDK client
- `lib/openai.ts` — OpenAI SDK client (embeddings only)
- `lib/embeddings.ts` — `generateEmbedding(text)`, provider-agnostic facade

## Environment variables

See `.env.example` for the full list and where to find each value.

_TODO: project overview & docs._
