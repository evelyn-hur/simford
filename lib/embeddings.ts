import { openai } from "@/lib/openai";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate a vector embedding for the given text.
 *
 * The underlying provider (currently OpenAI's text-embedding-3-small) is
 * intentionally hidden behind this function so callers depend only on the
 * `string -> number[1536]` contract. Swap the implementation here to change
 * providers without touching call sites.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
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
}
