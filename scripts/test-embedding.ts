/**
 * Smoke-test the embedding pipeline.
 *
 * Run with: npx tsx scripts/test-embedding.ts
 */

import { config } from "dotenv";
import { resolve } from "node:path";

// Load .env.local BEFORE importing lib/embeddings: lib/openai.ts throws at
// import time if OPENAI_API_KEY is unset, and static ES imports are evaluated
// before any other statements — so the embeddings module is imported
// dynamically, after env is in place.
config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { generateEmbedding } = await import("../lib/embeddings");

  const text = "I'm worried about my CS161 midterm";

  console.log(`Embedding: "${text}"`);
  const vector = await generateEmbedding(text);

  console.log(`Vector length: ${vector.length} (expected 1536)`);
  console.log(`First 5 dimensions: [${vector.slice(0, 5).join(", ")}]`);

  if (vector.length !== 1536) {
    console.error("Unexpected vector length!");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
