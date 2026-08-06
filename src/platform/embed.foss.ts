//
// Pure-JS lexical embedder — the FOSS stand-in for the MiniLM semantic embedder
// (src/platform/embed.ts). Same `embedTexts` signature, so src/logic/selection.ts
// feeds it to the vendor `diversePick` unchanged. Builds a hashed TF-IDF vector
// per title over the batch: tokenize, feature-hash tokens into a fixed-dim
// vector, weight by tf * idf (idf computed across the batch), L2-normalize.
// No model, no native code, no cache — it picks lexically-diverse titles
// (different words) rather than MiniLM's meaning-diverse ones.

const DIM = 256;

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

/* eslint-disable no-bitwise -- djb2 feature hashing (hashing trick) */
function hashToken(tok: string): number {
  let h = 5381;
  for (let i = 0; i < tok.length; i++) h = ((h << 5) + h + tok.charCodeAt(i)) | 0;
  return (h >>> 0) % DIM;
}
/* eslint-enable no-bitwise */

export async function embedTexts(
  texts: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Float32Array[]> {
  const N = texts.length;
  const docs = texts.map(tokenize);

  // Document frequency per hashed bucket (count each bucket once per title).
  const df = new Float32Array(DIM);
  for (const toks of docs) {
    const seen = new Set<number>();
    for (const tok of toks) seen.add(hashToken(tok));
    for (const b of seen) df[b] += 1;
  }
  const idf = new Float32Array(DIM);
  for (let b = 0; b < DIM; b++) idf[b] = Math.log((N + 1) / (df[b] + 1)) + 1;

  const out: Float32Array[] = texts.map((_, i) => {
    const v = new Float32Array(DIM);
    for (const tok of docs[i]) v[hashToken(tok)] += 1; // term frequency
    for (let b = 0; b < DIM; b++) v[b] *= idf[b];
    let norm = 0;
    for (let b = 0; b < DIM; b++) norm += v[b] * v[b];
    norm = Math.sqrt(norm) || 1; // empty title → zero vector stays zero
    for (let b = 0; b < DIM; b++) v[b] /= norm;
    onProgress?.(i + 1, N);
    return v;
  });
  return out;
}
