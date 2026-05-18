import { openai } from "@/lib/openai";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

// Retry config: one retry after a short exponential backoff.
const MAX_RETRIES = 1;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a vector embedding for the given text.
 *
 * The underlying provider (currently OpenAI's text-embedding-3-small) is
 * intentionally hidden behind this function so callers depend only on the
 * `string -> number[1536]` contract. Swap the implementation here to change
 * providers without touching call sites.
 *
 * Retries once on failure with exponential backoff (transient API/network
 * errors are common); a malformed-dimension response is also treated as a
 * retryable failure.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text,
      });

      const embedding = response.data[0]?.embedding;

      if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Expected a ${EMBEDDING_DIMENSIONS}-dimensional embedding, got ${
            embedding?.length ?? 0
          }`,
        );
      }

      return embedding;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        // Exponential backoff: BASE_DELAY_MS * 2^attempt.
        await sleep(BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }

  const reason =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `generateEmbedding failed after ${MAX_RETRIES + 1} attempt(s): ${reason}`,
  );
}

/**
 * Cosine similarity between two equal-length vectors, in [-1, 1].
 *
 * For in-memory similarity ranking (e.g. comparing embeddings without a
 * round-trip to pgvector). Returns 0 if either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector length mismatch: ${a.length} vs ${b.length}`,
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
