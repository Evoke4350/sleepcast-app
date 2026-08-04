import type { Encoding } from "./tokenizer";

export function meanPoolNormalize(hidden: Float32Array, mask: number[], dim: number): Float32Array {
  const out = new Float32Array(dim);
  let count = 0;
  for (let t = 0; t < mask.length; t++) {
    if (!mask[t]) continue;
    count++;
    for (let d = 0; d < dim; d++) out[d] += hidden[t * dim + d];
  }
  if (count) for (let d = 0; d < dim; d++) out[d] /= count;
  let norm = 0;
  for (let d = 0; d < dim; d++) norm += out[d] * out[d];
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < dim; d++) out[d] /= norm;
  return out;
}

export type RunSession = (encs: Encoding[]) => Promise<Float32Array[]>;

// --- Cache: ported verbatim from vendor/player semantic-model.ts ---
const CACHE_KEY = "sleepcast2.titlevecs";
const CACHE_CAP = 6000;

/* eslint-disable no-bitwise -- djb2 string hash, ported verbatim from vendor semantic-model.ts */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
/* eslint-enable no-bitwise */
type VecCache = Record<string, number[]>;
function loadCache(): VecCache { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; } }
function saveCache(cache: VecCache) {
  const keys = Object.keys(cache);
  if (keys.length > CACHE_CAP) for (const k of keys.slice(0, keys.length - CACHE_CAP)) delete cache[k];
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* quota */ }
}
const dequant = (q: number[]) => Float32Array.from(q, (x) => x / 127);

export function makeEmbedder(run: RunSession, tokenize: (t: string) => Encoding) {
  return async function embed(
    texts: string[],
    onProgress?: (done: number, total: number) => void
  ): Promise<Float32Array[]> {
    const cache = loadCache();
    const out: (Float32Array | null)[] = texts.map((t) => {
      const hit = cache[hash(t)];
      return hit ? dequant(hit) : null;
    });
    const missing = out.flatMap((v, i) => (v === null ? [i] : []));
    if (missing.length) {
      const vecs = await run(missing.map((i) => tokenize(texts[i])));
      let done = 0;
      missing.forEach((i, k) => {
        out[i] = vecs[k];
        cache[hash(texts[i])] = Array.from(vecs[k], (x) => Math.round(x * 127));
        onProgress?.(++done, missing.length);
      });
      saveCache(cache);
    }
    return out as Float32Array[];
  };
}

// --- Production runner: onnxruntime-react-native + bundled MiniLM ---
//
// Metro `require()` of a bundled asset (.onnx / .txt, see metro.config.js)
// returns an asset *reference*, not a filesystem path or the file's text —
// this is what Task 3's embed.smoke.ts proved and this file inherits that
// pattern rather than the brief's synchronous `require(...)` sketch, which
// does not resolve on RN. Both the model and the vocab must be resolved to a
// URI (Image.resolveAssetSource) and fetched (Metro dev-server URL in debug,
// packaged resource in release) before they can be used, so session/tokenizer
// construction is unavoidably async. That's done once, lazily, behind a
// shared module-level Promise — mirroring the web's lazy `getExtractor` and
// Task 3's lazy `sessionP` — and held for the process lifetime.
import { Image } from "react-native";
// Type-only: onnxruntime-react-native's binding installs its native JSI API
// as a side effect of being `require`d (Task 3's finding). A static value
// import would run that install at module-load time — which crashes under
// Jest, where no native module is mocked, even for tests that never touch
// the production runner. So the runtime binding is pulled in lazily, inside
// init(), and only the types are imported here.
import type { InferenceSession, Tensor as TensorCtor } from "onnxruntime-react-native";
import { makeTokenizer, loadVocab } from "./tokenizer";

const DIM = 384;
const OUTPUT = "last_hidden_state"; // confirmed on-device in Task 3, Step 2
const MAX_LEN = 128;

interface Ready {
  session: InferenceSession;
  Tensor: typeof TensorCtor;
  tokenize: (t: string) => Encoding;
}

let readyP: Promise<Ready> | null = null;

async function fetchAssetBytes(mod: number): Promise<Uint8Array> {
  const source = Image.resolveAssetSource(mod);
  const res = await fetch(source.uri);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchAssetText(mod: number): Promise<string> {
  const source = Image.resolveAssetSource(mod);
  const res = await fetch(source.uri);
  return res.text();
}

function init(): Promise<Ready> {
  if (!readyP) {
    readyP = (async () => {
      const { InferenceSession, Tensor } = require("onnxruntime-react-native");
      const modelRef = require("../assets/minilm/model.onnx");
      const vocabRef = require("../assets/minilm/vocab.txt");
      const [modelBytes, vocabTxt] = await Promise.all([
        fetchAssetBytes(modelRef),
        fetchAssetText(vocabRef),
      ]);
      const session = await InferenceSession.create(modelBytes);
      const tokenize = makeTokenizer(loadVocab(vocabTxt), MAX_LEN);
      return { session, Tensor, tokenize };
    })().catch((e) => {
      readyP = null; // a transient failure must not brick the feature until reload
      throw e;
    });
  }
  return readyP;
}

function bigInt64(a: number[]): BigInt64Array {
  return BigInt64Array.from(a, (x) => BigInt(x));
}

function makeRunSession(session: InferenceSession, Tensor: typeof TensorCtor): RunSession {
  return async (encs) => {
    const results: Float32Array[] = [];
    for (const enc of encs) {
      const len = enc.inputIds.length;
      const feeds: Record<string, InstanceType<typeof TensorCtor>> = {
        input_ids: new Tensor("int64", bigInt64(enc.inputIds), [1, len]),
        attention_mask: new Tensor("int64", bigInt64(enc.attentionMask), [1, len]),
        token_type_ids: new Tensor("int64", bigInt64(enc.tokenTypeIds), [1, len]),
      };
      const out = await session.run(feeds);
      const hidden = out[OUTPUT].data as Float32Array; // [1, len, DIM]
      results.push(meanPoolNormalize(hidden, enc.attentionMask, DIM));
    }
    return results;
  };
}

export async function embedTexts(
  texts: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Float32Array[]> {
  const { session, Tensor, tokenize } = await init();
  return makeEmbedder(makeRunSession(session, Tensor), tokenize)(texts, onProgress);
}
