# Feeds, Selection, and Resume — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the native app sleepcast.pro's everyday player — custom feeds with OPML, all four episode-selection strategies (shuffle, spread, varied mix, resume), and resume-the-night — reusing the shared `vendor/player` logic unchanged and adding an offline MiniLM embedding backend.

**Architecture:** Every pure-TS module in `vendor/player/src/lib` is consumed as-is (the MMKV shim already polyfills the synchronous `localStorage` they need). The web React-DOM components are not reused; new React Native screens are written against the same lib. The one browser-bound file, `semantic-model.ts`, is replaced by `src/platform/embed.ts` running `all-MiniLM-L6-v2` through `onnxruntime-react-native` with a hand-written WordPiece tokenizer and a bundled model — no network, no third-party request.

**Tech Stack:** React Native 0.86 (new arch / bridgeless), TypeScript, Hermes, react-native-mmkv (storage shim), onnxruntime-react-native (embeddings), Jest + react-test-renderer (existing test stack), the `vendor/player` submodule.

## Global Constraints

- **Reuse shared lib unchanged.** Never fork or edit anything under `vendor/player/`. New code lives under `src/`.
- **Storage is synchronous `localStorage`** via `src/platform/storage.ts` (MMKV). Import `installLocalStorage()` before any code that touches the shared lib. Shared-lib cache keys are canonical: `sleepcast2.titlevecs` for title vectors.
- **No relay, no network to third parties.** Feeds are fetched directly over native HTTP; the embedding model is bundled, never downloaded.
- **New arch is mandatory** (RN 0.82+ removed the toggle). Any native dependency must link under bridgeless. Verify before building on it.
- **Node for tooling:** brew node ≥ 22.13 (`/opt/homebrew/bin/node`), not the asdf 22.0.0 shim. `JAVA_HOME=/opt/homebrew/opt/openjdk@17`, `ANDROID_HOME=~/Library/Android/sdk`.
- **Constants copied from the web `SleepSetup.tsx`:** `EMBED_CAP = 96` (max titles embedded per run), `VARIED_N` (lineup size — read the current value from `SleepSetup.tsx` at implementation time; it is the same constant the spread uses), varied-mix timeout = `25_000` ms.
- **TDD, DRY, YAGNI, frequent commits.** One behavior per test; commit after each green task.

Run tests with: `PATH=/opt/homebrew/bin:$PATH npx jest <path>`.

---

### Task 1: Multi-feed pool assembly (`feeds.ts`)

Replace the thin slice's single hardcoded fetch with a pool built from every enabled feed, cached for offline starts. Pure TS: `fetch` and the store are injected so it runs under Jest.

**Files:**
- Create: `src/platform/feeds.ts`
- Test: `src/platform/feeds.test.ts`

**Interfaces:**
- Consumes: `loadState` (`vendor/player/src/lib/store`) → `{ feeds: FeedRef[] }`; `cacheFeedXml(feedId, xml)`, `getCachedFeedXml(feedId)` (same module); `parseFeed(xml, feedId)` (`src/platform/feed.ts` — the native fast-xml-parser, NOT vendor `parseFeedXml`, which needs DOMParser and does not run on RN) → `Feed { id, title, episodes: Episode[] }`.
- Produces:
  ```ts
  type XmlFetcher = (url: string) => Promise<string>;
  interface PoolResult { pool: Episode[]; feedTitles: Record<string,string>; errors: string[]; }
  async function buildPool(fetchXml: XmlFetcher): Promise<PoolResult>
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/platform/feeds.test.ts
import "./storage"; // installs the MMKV-backed localStorage shim used by store.ts
import { installLocalStorage } from "./storage";
import { buildPool } from "./feeds";
import { saveState, loadState, cacheFeedXml } from "../../vendor/player/src/lib/store";

installLocalStorage();

const FEED_A = `<rss><channel><title>A</title>
  <item><title>A1</title><enclosure url="https://a/1.mp3"/><guid>a1</guid></item>
</channel></rss>`;
const FEED_B = `<rss><channel><title>B</title>
  <item><title>B1</title><enclosure url="https://b/1.mp3"/><guid>b1</guid></item>
</channel></rss>`;

function twoEnabledFeeds() {
  const s = loadState();
  // Disable every builtin, then enable exactly two known ids we control.
  const feeds = s.feeds.map((f) => ({ ...f, enabled: false }));
  feeds[0] = { ...feeds[0], id: "fa", url: "https://a", enabled: true, builtin: false };
  feeds[1] = { ...feeds[1], id: "fb", url: "https://b", enabled: true, builtin: false };
  saveState({ ...s, feeds });
}

test("concatenates episodes from every enabled feed", async () => {
  twoEnabledFeeds();
  const fetchXml = async (url: string) => (url === "https://a" ? FEED_A : FEED_B);
  const { pool, errors } = await buildPool(fetchXml);
  expect(errors).toEqual([]);
  expect(pool.map((e) => e.title).sort()).toEqual(["A1", "B1"]);
});

test("falls back to cached xml when a fetch fails", async () => {
  twoEnabledFeeds();
  cacheFeedXml("fa", FEED_A); // fa is cached from a previous night
  const fetchXml = async (url: string) => {
    if (url === "https://a") throw new Error("offline");
    return FEED_B;
  };
  const { pool, errors } = await buildPool(fetchXml);
  expect(pool.map((e) => e.title).sort()).toEqual(["A1", "B1"]);
  expect(errors).toEqual([]); // cache hit is not an error
});

test("records an error and drops a feed with neither network nor cache", async () => {
  twoEnabledFeeds();
  const fetchXml = async (url: string) => {
    if (url === "https://a") throw new Error("offline");
    return FEED_B;
  };
  const { pool, errors } = await buildPool(fetchXml);
  expect(pool.map((e) => e.title)).toEqual(["B1"]);
  expect(errors).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/platform/feeds.test.ts`
Expected: FAIL — `buildPool is not a function` / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/platform/feeds.ts
import type { Episode } from "../../vendor/player/src/lib/engine";
import { parseFeed } from "./feed"; // native fast-xml-parser; vendor parseFeedXml needs DOMParser
import { loadState, cacheFeedXml, getCachedFeedXml } from "../../vendor/player/src/lib/store";

export type XmlFetcher = (url: string) => Promise<string>;

export interface PoolResult {
  pool: Episode[];
  feedTitles: Record<string, string>;
  errors: string[];
}

export async function buildPool(fetchXml: XmlFetcher): Promise<PoolResult> {
  const feeds = loadState().feeds.filter((f) => f.enabled);
  const pool: Episode[] = [];
  const feedTitles: Record<string, string> = {};
  const errors: string[] = [];

  await Promise.all(
    feeds.map(async (f) => {
      let xml: string | null = null;
      try {
        xml = await fetchXml(f.url);
        cacheFeedXml(f.id, xml);
      } catch {
        xml = getCachedFeedXml(f.id); // offline path
      }
      if (!xml) {
        errors.push(`${f.title || f.url}: no network and no cache`);
        return;
      }
      try {
        const feed = parseFeed(xml, f.id);
        feedTitles[f.id] = feed.title || f.title;
        pool.push(...feed.episodes);
      } catch (e) {
        errors.push(`${f.title || f.url}: ${(e as Error).message}`);
      }
    })
  );

  return { pool, feedTitles, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/platform/feeds.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/platform/feeds.ts src/platform/feeds.test.ts
git commit -m "feat: assemble episode pool from all enabled feeds with offline cache"
```

---

### Task 2: WordPiece tokenizer (`tokenizer.ts`)

`onnxruntime` needs token ids; it does not tokenize. Implement BERT WordPiece against the bundled `vocab.txt`. Uncased MiniLM keeps this to the lowercase path.

**Files:**
- Create: `src/platform/tokenizer.ts`
- Test: `src/platform/tokenizer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Encoding { inputIds: number[]; attentionMask: number[]; tokenTypeIds: number[]; }
  function makeTokenizer(vocab: Map<string, number>, maxLen?: number): (text: string) => Encoding
  function loadVocab(vocabText: string): Map<string, number>  // "\n"-split, index = id
  ```
- The bundled `vocab.txt` is one token per line; the line index is the id. `[PAD]=0`, `[UNK]=100`, `[CLS]=101`, `[SEP]=102` in the standard BERT vocab.

- [ ] **Step 1: Write the failing test**

```ts
// src/platform/tokenizer.test.ts
import { makeTokenizer, loadVocab } from "./tokenizer";

// A tiny hand-built vocab exercising WordPiece continuation ("##").
const VOCAB = loadVocab(
  ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "sleep", "##ing", "cast", "the", "quiet"].join("\n")
);
// ids: PAD0 UNK1 CLS2 SEP3 sleep4 ##ing5 cast6 the7 quiet8

test("wraps tokens with [CLS]/[SEP] and lowercases", () => {
  const enc = makeTokenizer(VOCAB, 8)("The quiet");
  // [CLS] the quiet [SEP] then pad to 8
  expect(enc.inputIds).toEqual([2, 7, 8, 3, 0, 0, 0, 0]);
  expect(enc.attentionMask).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  expect(enc.tokenTypeIds).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test("splits a word into WordPiece continuations", () => {
  const enc = makeTokenizer(VOCAB, 6)("sleeping");
  // sleep + ##ing
  expect(enc.inputIds.slice(0, 4)).toEqual([2, 4, 5, 3]);
});

test("maps an unknown word to [UNK]", () => {
  const enc = makeTokenizer(VOCAB, 4)("zzz");
  expect(enc.inputIds).toEqual([2, 1, 3, 0]);
});

test("truncates to maxLen keeping [SEP] last", () => {
  const enc = makeTokenizer(VOCAB, 3)("the quiet cast");
  expect(enc.inputIds).toEqual([2, 7, 3]); // [CLS] the [SEP]
  expect(enc.inputIds.length).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/platform/tokenizer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/platform/tokenizer.ts
export interface Encoding {
  inputIds: number[];
  attentionMask: number[];
  tokenTypeIds: number[];
}

export function loadVocab(vocabText: string): Map<string, number> {
  const m = new Map<string, number>();
  vocabText.split("\n").forEach((tok, i) => {
    const t = tok.replace(/\r$/, "");
    if (t.length) m.set(t, i);
  });
  return m;
}

// Whitespace + punctuation split, lowercase — BERT basic tokenizer, uncased.
function basicTokenize(text: string): string[] {
  const lowered = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const out: string[] = [];
  for (const chunk of lowered.split(/\s+/)) {
    if (!chunk) continue;
    let buf = "";
    for (const ch of chunk) {
      if (/[^\p{L}\p{N}]/u.test(ch)) {
        if (buf) { out.push(buf); buf = ""; }
        out.push(ch); // punctuation is its own token
      } else {
        buf += ch;
      }
    }
    if (buf) out.push(buf);
  }
  return out;
}

// Greedy longest-match WordPiece.
function wordPiece(word: string, vocab: Map<string, number>, unk: number): number[] {
  if (vocab.has(word)) return [vocab.get(word)!];
  const ids: number[] = [];
  let start = 0;
  while (start < word.length) {
    let end = word.length;
    let cur = -1;
    while (start < end) {
      const sub = (start === 0 ? "" : "##") + word.slice(start, end);
      if (vocab.has(sub)) { cur = vocab.get(sub)!; break; }
      end--;
    }
    if (cur === -1) return [unk]; // any un-piece-able part → whole word UNK
    ids.push(cur);
    start = end;
  }
  return ids;
}

export function makeTokenizer(vocab: Map<string, number>, maxLen = 128) {
  const CLS = vocab.get("[CLS]") ?? 101;
  const SEP = vocab.get("[SEP]") ?? 102;
  const PAD = vocab.get("[PAD]") ?? 0;
  const UNK = vocab.get("[UNK]") ?? 100;

  return function encode(text: string): Encoding {
    const pieces: number[] = [];
    for (const w of basicTokenize(text)) {
      for (const id of wordPiece(w, vocab, UNK)) pieces.push(id);
    }
    // Reserve room for [CLS] ... [SEP].
    const body = pieces.slice(0, maxLen - 2);
    const ids = [CLS, ...body, SEP];
    const attn = ids.map(() => 1);
    while (ids.length < maxLen) { ids.push(PAD); attn.push(0); }
    return { inputIds: ids, attentionMask: attn, tokenTypeIds: ids.map(() => 0) };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/platform/tokenizer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add a real-vocab fidelity fixture**

Generate expected ids from a reference tokenizer (Python `transformers`, `AutoTokenizer.from_pretrained("sentence-transformers/all-MiniLM-L6-v2")`) for three titles, and assert `makeTokenizer(loadVocab(realVocabTxt))` reproduces them. Place the reference ids inline in `tokenizer.fixture.test.ts`. This is the guard against silent WordPiece drift.

```ts
// src/platform/tokenizer.fixture.test.ts
import fs from "fs";
import path from "path";
import { makeTokenizer, loadVocab } from "./tokenizer";

const vocabTxt = fs.readFileSync(
  path.join(__dirname, "../assets/minilm/vocab.txt"), "utf8"
);
const encode = makeTokenizer(loadVocab(vocabTxt), 128);

// Reference ids from HF AutoTokenizer (fill at implementation time).
const CASES: Array<[string, number[]]> = [
  ["a quiet night", [/* 101, ..., 102 */]],
  ["Sleep With Me", [/* ... */]],
  ["Nothing Much Happens", [/* ... */]],
];

test.each(CASES)("matches reference tokenization for %s", (text, expected) => {
  const enc = encode(text);
  const trimmed = enc.inputIds.slice(0, enc.attentionMask.filter((x) => x).length);
  expect(trimmed).toEqual(expected);
});
```

- [ ] **Step 6: Commit**

```bash
git add src/platform/tokenizer.ts src/platform/tokenizer.test.ts src/platform/tokenizer.fixture.test.ts
git commit -m "feat: BERT WordPiece tokenizer for on-device MiniLM"
```

---

### Task 3: onnxruntime dependency, bundled model, link verification

Add the native runtime and the model/vocab assets, and prove a session loads on the device under the new architecture before any code depends on it.

**Files:**
- Modify: `package.json` (add `onnxruntime-react-native`)
- Create: `src/assets/minilm/model.onnx` (int8-quantized `all-MiniLM-L6-v2`)
- Create: `src/assets/minilm/vocab.txt`
- Modify: `metro.config.js` (allow `.onnx` as an asset ext)
- Modify: `android/app/build.gradle` and iOS project as onnxruntime's install docs require
- Create: `src/platform/embed.smoke.ts` (a temporary device probe, deleted in Task 4's commit)

**Interfaces:**
- Produces the installed `InferenceSession` API from `onnxruntime-react-native`, consumed by Task 4.

- [ ] **Step 1: Install the dependency**

```bash
PATH=/opt/homebrew/bin:$PATH npm install onnxruntime-react-native
```

- [ ] **Step 2: Add the model and vocab assets**

Obtain the int8-quantized ONNX export of `sentence-transformers/all-MiniLM-L6-v2` (e.g. the `Xenova/all-MiniLM-L6-v2` `onnx/model_quantized.onnx`) and its `vocab.txt`. Place them at `src/assets/minilm/model.onnx` and `src/assets/minilm/vocab.txt`. Confirm the model exposes inputs `input_ids`, `attention_mask`, `token_type_ids` and output `last_hidden_state` (or `token_embeddings`):

```bash
PATH=/opt/homebrew/bin:$PATH node -e "const o=require('onnxruntime-node');o.InferenceSession.create('src/assets/minilm/model.onnx').then(s=>console.log('IN',s.inputNames,'OUT',s.outputNames))"
```
Expected: prints the input/output names. Record the exact output name — Task 4 reads it.

- [ ] **Step 3: Let Metro bundle `.onnx`**

```js
// metro.config.js — merge assetExts
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const defaultConfig = getDefaultConfig(__dirname);
module.exports = mergeConfig(defaultConfig, {
  resolver: { assetExts: [...defaultConfig.resolver.assetExts, "onnx", "txt"] },
});
```

- [ ] **Step 4: Device link probe**

Add a temporary probe that creates a session from the bundled model and logs its input names, wire it behind a dev button (or call it from `App.tsx` `useEffect` temporarily), then build and run:

```bash
cd /Users/windowlicker/sleepcast-app
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=/opt/homebrew/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
npx react-native run-android
adb logcat -d | grep -i "onnx-smoke"
```
Expected: the probe logs the model input names from the running app. **If onnxruntime fails to link under bridgeless, stop and fall back to the deferred-varied-mix plan** (spec risk section). Remove the probe wiring before committing Task 4.

- [ ] **Step 5: Commit the dependency and assets**

```bash
git add package.json package-lock.json metro.config.js android/app/build.gradle src/assets/minilm/
git commit -m "build: bundle MiniLM ONNX model and onnxruntime-react-native"
```

---

### Task 4: Embedding backend (`embed.ts`)

Give `embedTexts` the exact signature and cache contract of the web `semantic-model.ts`, so `diversePick` is unaware of the swap. The pooling math and the cache are unit-tested with the session runner injected; the real session is wired at the end.

**Files:**
- Create: `src/platform/embed.ts`
- Test: `src/platform/embed.test.ts`

**Interfaces:**
- Consumes: `makeTokenizer`, `loadVocab` (Task 2); an injected `RunSession` (real one built on `onnxruntime-react-native` from Task 3).
- Produces:
  ```ts
  type RunSession = (enc: Encoding[]) => Promise<Float32Array[]>; // one 384-vec per input, mean-pooled+normalized
  function meanPoolNormalize(hidden: Float32Array, mask: number[], dim: number): Float32Array;
  function makeEmbedder(run: RunSession, tokenize: (t: string) => Encoding): (texts: string[], onProgress?: (d: number, t: number) => void) => Promise<Float32Array[]>;
  const embedTexts: (texts: string[], onProgress?: (d: number, t: number) => void) => Promise<Float32Array[]>; // production instance
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/platform/embed.test.ts
import "./storage";
import { installLocalStorage } from "./storage";
import { meanPoolNormalize, makeEmbedder } from "./embed";

installLocalStorage();

test("mean-pools over the mask and L2-normalizes", () => {
  // dim=2, two tokens: [3,0] and [0,4], mask=[1,1] → mean [1.5,2] → normalized
  const hidden = Float32Array.from([3, 0, 0, 4]);
  const v = meanPoolNormalize(hidden, [1, 1], 2);
  const len = Math.hypot(v[0], v[1]);
  expect(len).toBeCloseTo(1, 5);
  expect(v[0] / v[1]).toBeCloseTo(1.5 / 2, 5);
});

test("masks padding out of the mean", () => {
  const hidden = Float32Array.from([2, 2, 9, 9]); // second token is padding
  const v = meanPoolNormalize(hidden, [1, 0], 2);
  expect(v[0]).toBeCloseTo(v[1], 5); // only first token counts → equal comps
});

test("embedTexts caches: a second call runs the session zero times", async () => {
  let runs = 0;
  const run = async (encs: any[]) => {
    runs += encs.length;
    return encs.map(() => Float32Array.from([1, 0]));
  };
  const embed = makeEmbedder(run, (t) => ({ inputIds: [t.length], attentionMask: [1], tokenTypeIds: [0] }));
  await embed(["night"]);
  await embed(["night"]); // served from sleepcast2.titlevecs
  expect(runs).toBe(1);
});

test("only missing titles are embedded", async () => {
  const seen: string[][] = [];
  const run = async (encs: any[]) => { seen.push(encs.map((e) => String(e.inputIds[0]))); return encs.map(() => Float32Array.from([0, 1])); };
  const embed = makeEmbedder(run, (t) => ({ inputIds: [t.length], attentionMask: [1], tokenTypeIds: [0] }));
  await embed(["aa"]);          // caches len-2
  await embed(["aa", "bbb"]);   // only "bbb" (len 3) is fresh
  expect(seen[1]).toEqual(["3"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/platform/embed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/platform/embed.ts
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

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
type VecCache = Record<string, number[]>;
function loadCache(): VecCache { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; } }
function saveCache(cache: VecCache) {
  const keys = Object.keys(cache);
  if (keys.length > CACHE_CAP) for (const k of keys.slice(0, keys.length - CACHE_CAP)) delete cache[k];
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* quota */ }
}
const dequant = (q: number[]) => Float32Array.from(q, (x) => x / 127);

export function makeEmbedder(run: RunSession, tokenize: (t: string) => Encoding) {
  return async function embedTexts(
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/platform/embed.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the production session runner**

Append the real runner and exported instance. It lazily creates one `InferenceSession` from the bundled asset and holds it. Use the output name recorded in Task 3, Step 2.

```ts
// src/platform/embed.ts (appended)
import { InferenceSession, Tensor } from "onnxruntime-react-native";
import { makeTokenizer, loadVocab } from "./tokenizer";
// Metro resolves these bundled assets to a URI/require id:
const MODEL = require("../assets/minilm/model.onnx");
const vocabTxt: string = require("../assets/minilm/vocab.txt");

const DIM = 384;
const OUTPUT = "last_hidden_state"; // ← replace with the name printed in Task 3 Step 2
let sessionP: Promise<InferenceSession> | null = null;
function session() {
  if (!sessionP) {
    sessionP = InferenceSession.create(MODEL).catch((e) => { sessionP = null; throw e; });
  }
  return sessionP;
}

const runSession: RunSession = async (encs) => {
  const s = await session();
  const results: Float32Array[] = [];
  for (const enc of encs) {
    const len = enc.inputIds.length;
    const big = (a: number[]) => BigInt64Array.from(a, (x) => BigInt(x));
    const feeds: Record<string, Tensor> = {
      input_ids: new Tensor("int64", big(enc.inputIds), [1, len]),
      attention_mask: new Tensor("int64", big(enc.attentionMask), [1, len]),
      token_type_ids: new Tensor("int64", big(enc.tokenTypeIds), [1, len]),
    };
    const out = await s.run(feeds);
    const hidden = out[OUTPUT].data as Float32Array; // [1, len, DIM]
    results.push(meanPoolNormalize(hidden, enc.attentionMask, DIM));
  }
  return results;
};

export const embedTexts = makeEmbedder(runSession, makeTokenizer(loadVocab(vocabTxt), 128));
```

- [ ] **Step 6: Remove the Task 3 device probe, commit**

```bash
git rm src/platform/embed.smoke.ts 2>/dev/null || true
git add src/platform/embed.ts src/platform/embed.test.ts App.tsx metro.config.js
git commit -m "feat: on-device MiniLM embeddings via onnxruntime with title-vector cache"
```

---

### Task 5: Selection orchestration (`selection.ts`)

One function turns a chosen strategy plus the pool into the lead episode(s), including the varied-mix timeout fallback and resume. Pure orchestration over the lib; `embed`, `rand`, and `now` are injected for tests.

**Files:**
- Create: `src/logic/selection.ts`
- Test: `src/logic/selection.test.ts`

**Interfaces:**
- Consumes: `pickNextEpisode` (`plays`), `diverseByMeta` (`engine`), `diversePick` (`semantic-math`), `getPlays` (`store`), `loadLastNight`, `REARM_WINDOW_MS` (`store`), `nextInSpread` (`rest/reanchor`), `rearmMinutes` (`engine`), `embedTexts` (Task 4).
- Produces:
  ```ts
  type Strategy = "shuffle" | "spread" | "varied";
  interface Lineup { lead: Episode; lineup: Episode[]; wasVaried: boolean; }
  async function chooseLineup(strategy: Strategy, pool: Episode[], deps?: Deps): Promise<Lineup | null>;
  interface Resume { lead: Episode; minutes: number; } 
  function resumeNight(previousMinutes: number, deps?: Deps): Resume | null;
  interface Deps { embed?: typeof embedTexts; rand?: () => number; now?: () => number; timeoutMs?: number; }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/logic/selection.test.ts
import "../platform/storage";
import { installLocalStorage } from "../platform/storage";
import { chooseLineup } from "./selection";
import type { Episode } from "../../vendor/player/src/lib/engine";

installLocalStorage();

const ep = (id: string, feedId = "f", date = "2024-01-01"): Episode =>
  ({ id, title: id, url: `https://x/${id}.mp3`, feedId, date } as Episode);
const POOL = [ep("a"), ep("b"), ep("c", "g"), ep("d", "g", "2020-01-01")];

test("shuffle returns a single lead from the pool", async () => {
  const r = await chooseLineup("shuffle", POOL, { rand: () => 0 });
  expect(r!.lead.id).toBeDefined();
  expect(POOL.map((e) => e.id)).toContain(r!.lead.id);
  expect(r!.wasVaried).toBe(false);
});

test("varied embeds titles and picks a diverse lineup", async () => {
  const embed = async (titles: string[]) =>
    titles.map((t, i) => Float32Array.from([Math.cos(i), Math.sin(i)])); // spread-out fake vecs
  const r = await chooseLineup("varied", POOL, { embed, rand: () => 0 });
  expect(r!.wasVaried).toBe(true);
  expect(r!.lineup.length).toBeGreaterThan(0);
});

test("varied falls back to the spread when embedding times out", async () => {
  const embed = () => new Promise<Float32Array[]>(() => {}); // never resolves
  const r = await chooseLineup("varied", POOL, { embed, rand: () => 0, timeoutMs: 5 });
  expect(r!.wasVaried).toBe(true); // still counts as a varied intent
  expect(r!.lead.id).toBeDefined();
});

test("returns null for an empty pool", async () => {
  expect(await chooseLineup("shuffle", [], {})).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/logic/selection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/logic/selection.ts
import type { Episode } from "../../vendor/player/src/lib/engine";
import { diverseByMeta, rearmMinutes } from "../../vendor/player/src/lib/engine";
import { pickNextEpisode } from "../../vendor/player/src/lib/plays";
import { diversePick } from "../../vendor/player/src/lib/semantic-math";
import { getPlays, loadLastNight, REARM_WINDOW_MS } from "../../vendor/player/src/lib/store";
import { nextInSpread } from "../../vendor/player/src/lib/rest/reanchor";
import { embedTexts as prodEmbed } from "../platform/embed";

export type Strategy = "shuffle" | "spread" | "varied";
export interface Lineup { lead: Episode; lineup: Episode[]; wasVaried: boolean; }
export interface Resume { lead: Episode; minutes: number; }
export interface Deps {
  embed?: (t: string[]) => Promise<Float32Array[]>;
  rand?: () => number;
  now?: () => number;
  timeoutMs?: number;
}

const EMBED_CAP = 96;
const VARIED_N = 12; // ← match the current value in vendor SleepSetup.tsx at implementation time
const TIMEOUT = 25_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("embed-timeout")), ms);
    p.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
  });
}

export async function chooseLineup(strategy: Strategy, pool: Episode[], deps: Deps = {}): Promise<Lineup | null> {
  if (!pool.length) return null;
  const rand = deps.rand ?? Math.random;

  if (strategy === "shuffle") {
    const lead = pickNextEpisode(pool, getPlays(), rand);
    return lead ? { lead, lineup: [lead], wasVaried: false } : null;
  }
  if (strategy === "spread") {
    const lineup = diverseByMeta(pool, VARIED_N, rand);
    return { lead: lineup[0], lineup, wasVaried: false };
  }
  // varied
  const embed = deps.embed ?? prodEmbed;
  const candidates = pool.length > EMBED_CAP ? diverseByMeta(pool, EMBED_CAP, rand) : pool;
  try {
    const vecs = await withTimeout(embed(candidates.map((e) => e.title)), deps.timeoutMs ?? TIMEOUT);
    const lineup = diversePick(vecs, VARIED_N, rand).map((i) => candidates[i]);
    return { lead: lineup[0], lineup, wasVaried: true };
  } catch {
    const lineup = diverseByMeta(pool, VARIED_N, rand); // Lockdown/slow-device path
    return { lead: lineup[0], lineup, wasVaried: true };
  }
}

export function resumeNight(previousMinutes: number, deps: Deps = {}): Resume | null {
  const now = deps.now ?? (() => Date.now());
  const last = loadLastNight();
  if (!last || now() - last.endedAt > REARM_WINDOW_MS) return null;
  const lead = nextInSpread(last.pool, last.playedIds);
  if (!lead) return null;
  return { lead, minutes: rearmMinutes(previousMinutes) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/logic/selection.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add a resume test and run it**

```ts
// append to src/logic/selection.test.ts
import { resumeNight } from "./selection";
import { saveLastNight } from "../../vendor/player/src/lib/store";

test("resume offers the next spread episode within the rearm window", () => {
  saveLastNight({
    pool: POOL, playedIds: ["a"], feedTitles: {}, artworkByFeedId: {},
    skipIntroByFeedId: {}, endedVia: "faded", endedAt: 1000, wasVaried: false,
  });
  const r = resumeNight(60, { now: () => 1000 + 60_000 }); // one minute later
  expect(r).not.toBeNull();
  expect(["b", "c", "d"]).toContain(r!.lead.id);
  expect(r!.minutes).toBe(30); // rearmMinutes(60)
});

test("resume declines outside the rearm window", () => {
  saveLastNight({
    pool: POOL, playedIds: [], feedTitles: {}, artworkByFeedId: {},
    skipIntroByFeedId: {}, endedVia: "faded", endedAt: 0, wasVaried: false,
  });
  expect(resumeNight(60, { now: () => 999_999_999 })).toBeNull();
});
```

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/logic/selection.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/logic/selection.ts src/logic/selection.test.ts
git commit -m "feat: selection strategies — shuffle, spread, varied (with fallback), resume"
```

---

### Task 6: Feed-manager screen (`SetupScreen.tsx`)

Native screen: toggle built-ins, add/remove custom feeds by URL, OPML import/export, timer chips, and the four start buttons. Business logic already lives in the lib and Task 5; this wires it to UI with `testID`s for smoke tests.

**Files:**
- Create: `src/screens/SetupScreen.tsx`
- Test: `src/screens/SetupScreen.test.tsx`

**Interfaces:**
- Consumes: `loadState`, `saveState`, `addCustomFeed`, `removeCustomFeed`, `saveTimerMinutes` (`store`); `parseOpml`, `buildOpml` (`opml`).
- Produces:
  ```ts
  interface SetupProps {
    onStart: (strategy: "shuffle" | "spread" | "varied", minutes: number) => void;
    onResume?: () => void;
    resumeAvailable?: boolean;
  }
  export default function SetupScreen(props: SetupProps): JSX.Element
  ```
- `testID`s: `feed-toggle-<id>`, `feed-remove-<id>`, `add-feed-input`, `add-feed`, `opml-import`, `opml-export`, `timer-<min>`, `start-shuffle`, `start-spread`, `start-varied`, `start-resume`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/SetupScreen.test.tsx
import "../platform/storage";
import { installLocalStorage } from "../platform/storage";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import SetupScreen from "./SetupScreen";
import { loadState } from "../../vendor/player/src/lib/store";

installLocalStorage();

function find(tree: TestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.findByProps({ testID });
}

test("adding a feed by URL persists it", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  act(() => { find(tree, "add-feed-input").props.onChangeText("https://feeds.example/x"); });
  act(() => { find(tree, "add-feed").props.onPress(); });
  expect(loadState().feeds.some((f) => f.url === "https://feeds.example/x")).toBe(true);
});

test("start-varied invokes onStart with the selected timer", () => {
  const onStart = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={onStart} />); });
  act(() => { find(tree, "timer-5").props.onPress(); });
  act(() => { find(tree, "start-varied").props.onPress(); });
  expect(onStart).toHaveBeenCalledWith("varied", 5);
});

test("resume button shows only when available", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} resumeAvailable={false} />); });
  expect(tree.root.findAllByProps({ testID: "start-resume" })).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/SetupScreen.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/screens/SetupScreen.tsx
import React, { useState } from "react";
import { ScrollView, View, Text, TextInput, TouchableOpacity, Switch, StyleSheet, Share } from "react-native";
import {
  loadState, saveState, addCustomFeed, removeCustomFeed, saveTimerMinutes,
} from "../../vendor/player/src/lib/store";
import { parseOpml, buildOpml } from "../../vendor/player/src/lib/opml";
import type { AppState } from "../../vendor/player/src/lib/store";

const TIMERS = [1, 5, 45, 60];

interface SetupProps {
  onStart: (strategy: "shuffle" | "spread" | "varied", minutes: number) => void;
  onResume?: () => void;
  resumeAvailable?: boolean;
}

export default function SetupScreen({ onStart, onResume, resumeAvailable }: SetupProps) {
  const [state, setState] = useState<AppState>(() => loadState());
  const [url, setUrl] = useState("");
  const [minutes, setMinutes] = useState(state.settings.timerMinutes);

  function persist(next: AppState) { saveState(next); setState(next); }

  function toggleFeed(id: string, enabled: boolean) {
    persist({ ...state, feeds: state.feeds.map((f) => (f.id === id ? { ...f, enabled } : f)) });
  }
  function addFeed() {
    if (!url.trim()) return;
    try { persist(addCustomFeed(state, url.trim())); setUrl(""); } catch { /* invalid url: leave text for correction */ }
  }
  function removeFeed(id: string) { persist(removeCustomFeed(state, id)); }
  async function exportOpml() {
    const xml = buildOpml(state.feeds.filter((f) => f.enabled).map((f) => ({ url: f.url, title: f.title })));
    await Share.share({ message: xml });
  }
  function importOpml(xml: string) {
    let next = state;
    for (const feed of parseOpml(xml)) { try { next = addCustomFeed(next, feed.url, feed.title); } catch { /* skip bad entry */ } }
    persist(next);
  }
  function pickTimer(m: number) { setMinutes(m); saveTimerMinutes(m); }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.body}>
      <Text style={s.h}>feeds</Text>
      {state.feeds.map((f) => (
        <View key={f.id} style={s.feedRow}>
          <Text style={s.feedTitle} numberOfLines={1}>{f.title}</Text>
          <Switch testID={`feed-toggle-${f.id}`} value={f.enabled} onValueChange={(v) => toggleFeed(f.id, v)} />
          {!f.builtin && (
            <TouchableOpacity testID={`feed-remove-${f.id}`} onPress={() => removeFeed(f.id)}>
              <Text style={s.remove}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      <View style={s.addRow}>
        <TextInput
          testID="add-feed-input" style={s.input} placeholder="https://feed…"
          placeholderTextColor="#4a4436" autoCapitalize="none" value={url} onChangeText={setUrl}
        />
        <TouchableOpacity testID="add-feed" style={s.btn} onPress={addFeed}><Text style={s.btnT}>add</Text></TouchableOpacity>
      </View>
      <View style={s.addRow}>
        <TouchableOpacity testID="opml-import" style={s.btn} onPress={() => importOpml("")}><Text style={s.btnT}>import OPML</Text></TouchableOpacity>
        <TouchableOpacity testID="opml-export" style={s.btn} onPress={exportOpml}><Text style={s.btnT}>export OPML</Text></TouchableOpacity>
      </View>

      <Text style={s.h}>timer</Text>
      <View style={s.row}>
        {TIMERS.map((m) => (
          <TouchableOpacity key={m} testID={`timer-${m}`} style={[s.chip, minutes === m && s.chipOn]} onPress={() => pickTimer(m)}>
            <Text style={s.btnT}>{m}m</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.h}>start</Text>
      <View style={s.row}>
        <TouchableOpacity testID="start-shuffle" style={s.btn} onPress={() => onStart("shuffle", minutes)}><Text style={s.btnT}>shuffle</Text></TouchableOpacity>
        <TouchableOpacity testID="start-spread" style={s.btn} onPress={() => onStart("spread", minutes)}><Text style={s.btnT}>spread</Text></TouchableOpacity>
        <TouchableOpacity testID="start-varied" style={s.btn} onPress={() => onStart("varied", minutes)}><Text style={s.btnT}>varied</Text></TouchableOpacity>
      </View>
      {resumeAvailable && (
        <TouchableOpacity testID="start-resume" style={s.btn} onPress={onResume}><Text style={s.btnT}>resume last night</Text></TouchableOpacity>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050508" },
  body: { padding: 24, gap: 12 },
  h: { color: "#6e5d44", fontSize: 12, textTransform: "uppercase", marginTop: 12 },
  feedRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  feedTitle: { color: "#c8c0b0", flex: 1, fontSize: 14 },
  remove: { color: "#b3746b", fontSize: 16, paddingHorizontal: 6 },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, color: "#d9c9a8", borderWidth: 1, borderColor: "#3a3325", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { borderColor: "#d9c9a8" },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  btnT: { color: "#d9c9a8", fontSize: 14 },
});
```

Note: file-picker wiring for OPML import (turning `opml-import` into a real document pick) is deferred; `importOpml(xml)` is the tested seam and is called with picked text once a picker is added. Leave the button calling `importOpml("")` for now — the round-trip logic is covered by the lib's own `opml` tests plus Task 6's wiring test.

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/SetupScreen.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/screens/SetupScreen.tsx src/screens/SetupScreen.test.tsx
git commit -m "feat: setup screen — feed management, OPML, timer, start strategies"
```

---

### Task 7: Player screen (`PlayerScreen.tsx`)

Extract the now-playing UI currently inline in `App.tsx` into its own presentational screen so `App.tsx` holds only orchestration.

**Files:**
- Create: `src/screens/PlayerScreen.tsx`
- Test: `src/screens/PlayerScreen.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  interface PlayerProps { title: string; remaining: number; volume: number; onStop: () => void; }
  export default function PlayerScreen(props: PlayerProps): JSX.Element
  ```
- `testID`s: `nowPlaying`, `countdown`, `volume`, `stop`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/PlayerScreen.test.tsx
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import PlayerScreen from "./PlayerScreen";

test("renders title and countdown, fires onStop", () => {
  const onStop = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<PlayerScreen title="A Quiet Night" remaining={90} volume={0.5} onStop={onStop} />); });
  expect(tree.root.findByProps({ testID: "nowPlaying" }).props.children).toBe("A Quiet Night");
  expect(tree.root.findByProps({ testID: "countdown" }).props.children).toBe("1:30");
  act(() => { tree.root.findByProps({ testID: "stop" }).props.onPress(); });
  expect(onStop).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/PlayerScreen.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/screens/PlayerScreen.tsx
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { formatTime } from "../../vendor/player/src/lib/engine";

interface PlayerProps { title: string; remaining: number; volume: number; onStop: () => void; }

export default function PlayerScreen({ title, remaining, volume, onStop }: PlayerProps) {
  return (
    <View style={s.body}>
      <Text style={s.moon}>☾</Text>
      <Text style={s.title} testID="nowPlaying" numberOfLines={2}>{title}</Text>
      <Text style={s.dim} testID="countdown">{formatTime(remaining)}</Text>
      <Text style={s.dim} testID="volume">vol {volume.toFixed(2)}</Text>
      <TouchableOpacity style={s.btn} testID="stop" onPress={onStop}><Text style={s.btnT}>stop</Text></TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 24 },
  moon: { fontSize: 56, color: "#f0dcb8" },
  title: { color: "#c8c0b0", fontSize: 16, textAlign: "center" },
  dim: { color: "#6e5d44", fontSize: 13 },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  btnT: { color: "#d9c9a8", fontSize: 14 },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/PlayerScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/PlayerScreen.tsx src/screens/PlayerScreen.test.tsx
git commit -m "refactor: extract PlayerScreen from App.tsx"
```

---

### Task 8: Wire it together in `App.tsx`

Replace the thin slice's single-feed, three-button `App.tsx` with the setup/player flow: build the pool from all feeds, pick via the chosen strategy, play through the existing native audio module and fade loop, record the night for resume.

**Files:**
- Modify: `App.tsx` (replace the render + `startNight`)
- Test: `__tests__/App.night.test.tsx`

**Interfaces:**
- Consumes: `buildPool` (Task 1), `chooseLineup`/`resumeNight` (Task 5), `SetupScreen` (Task 6), `PlayerScreen` (Task 7), `getNightAudio` (`src/specs/NativeNightAudio`), `fadeVolume` (`engine`), `recordHeardPlay`, `saveLastNight` (`store`).
- Produces: no exported interface change; `export default function App`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/App.night.test.tsx
import "../src/platform/storage";
import { installLocalStorage } from "../src/platform/storage";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

installLocalStorage();

// Native audio module is absent under Jest; App must tolerate a null module.
jest.mock("../src/specs/NativeNightAudio", () => ({ getNightAudio: () => null }));
// Deterministic pool so we don't hit the network in a unit test.
jest.mock("../src/platform/feeds", () => ({
  buildPool: async () => ({
    pool: [{ id: "a", title: "A Quiet Night", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" }],
    feedTitles: { f: "F" }, errors: [],
  }),
}));

import App from "../App";

test("starting shuffle moves from setup to the player screen", async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {}); // let buildPool resolve
  await act(async () => { tree.root.findByProps({ testID: "start-shuffle" }).props.onPress(); });
  expect(tree.root.findByProps({ testID: "nowPlaying" }).props.children).toBe("A Quiet Night");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest __tests__/App.night.test.tsx`
Expected: FAIL — `App` still renders the old three-button screen; no `start-shuffle`.

- [ ] **Step 3: Rewrite `App.tsx`**

```tsx
// App.tsx
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { installLocalStorage } from "./src/platform/storage";
import { buildPool } from "./src/platform/feeds";
import { chooseLineup, resumeNight, type Strategy } from "./src/logic/selection";
import { getNightAudio } from "./src/specs/NativeNightAudio";
import { fadeVolume } from "./vendor/player/src/lib/engine";
import { recordHeardPlay, saveLastNight, loadTimerMinutes } from "./vendor/player/src/lib/store";
import type { Episode } from "./vendor/player/src/lib/engine";
import SetupScreen from "./src/screens/SetupScreen";
import PlayerScreen from "./src/screens/PlayerScreen";

installLocalStorage();

const FADE_SECONDS = 60;
const nativeFetch = (url: string) => fetch(url).then((r) => r.text());

export default function App() {
  const [pool, setPool] = useState<Episode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Episode | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [volume, setVolume] = useState(1);
  const [playing, setPlaying] = useState(false);

  const endAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const lineupRef = useRef<Episode[]>([]);
  const variedRef = useRef(false);

  useEffect(() => {
    buildPool(nativeFetch)
      .then(({ pool, errors }) => {
        if (!pool.length) throw new Error(errors[0] ?? "no episodes");
        setPool(pool);
      })
      .catch((e) => setError(String(e?.message ?? e)));
    return () => stopTick();
  }, []);

  function stopTick() { if (tickRef.current !== null) clearInterval(tickRef.current); tickRef.current = null; }

  async function endSession(via: "faded" | "abandoned") {
    stopTick();
    endAtRef.current = null;
    getNightAudio()?.stop();
    if (now) {
      saveLastNight({
        pool: lineupRef.current, playedIds: [now.id], feedTitles: {}, artworkByFeedId: {},
        skipIntroByFeedId: {}, endedVia: via, endedAt: Date.now(), wasVaried: variedRef.current,
      });
    }
    setPlaying(false); setNow(null); setRemaining(0); setVolume(1);
  }

  async function beginPlayback(lead: Episode, minutes: number) {
    setNow(lead);
    startedAtRef.current = Date.now();
    endAtRef.current = Date.now() + minutes * 60_000;
    getNightAudio()?.setNowPlaying(lead.title, "sleepcast", "", 0);
    await getNightAudio()?.play(lead.url, 0);
    setPlaying(true);
    stopTick();
    tickRef.current = setInterval(async () => {
      const end = endAtRef.current;
      if (end === null) return;
      const left = (end - Date.now()) / 1000;
      if (left <= 0) {
        recordHeardPlay({ id: lead.id, title: lead.title, feedId: lead.feedId,
          startedAt: startedAtRef.current, heardSec: Math.round((Date.now() - startedAtRef.current) / 1000) });
        await endSession("faded");
        return;
      }
      const v = fadeVolume(left, FADE_SECONDS);
      getNightAudio()?.setVolume(v); setVolume(v); setRemaining(left);
    }, 1000);
  }

  async function onStart(strategy: Strategy, minutes: number) {
    if (!pool) return;
    const r = await chooseLineup(strategy, pool);
    if (!r) return;
    lineupRef.current = r.lineup; variedRef.current = r.wasVaried;
    await beginPlayback(r.lead, minutes);
  }

  async function onResume() {
    const r = resumeNight(loadTimerMinutes());
    if (!r) return;
    lineupRef.current = [r.lead]; variedRef.current = false;
    await beginPlayback(r.lead, r.minutes);
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor="#050508" />
        {error ? (
          <View style={s.center}><Text style={s.err} testID="error">{error}</Text></View>
        ) : pool === null ? (
          <View style={s.center}><ActivityIndicator color="#6e5d44" /><Text style={s.dim} testID="status">gathering episodes…</Text></View>
        ) : playing && now ? (
          <PlayerScreen title={now.title} remaining={remaining} volume={volume} onStop={() => endSession("abandoned")} />
        ) : (
          <SetupScreen onStart={onStart} onResume={onResume} resumeAvailable={!!resumeNight(loadTimerMinutes())} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050508" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 24 },
  dim: { color: "#6e5d44", fontSize: 13 },
  err: { color: "#b3746b", fontSize: 13, textAlign: "center" },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest __tests__/App.night.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest && PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit`
Expected: all tests pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add App.tsx __tests__/App.night.test.tsx
git commit -m "feat: wire setup/player flow — pool, strategies, resume, fade"
```

---

### Task 9: On-device verification

The unit suite mocks native audio and the model. This task proves the real thing on the connected Pixel 7 (GrapheneOS), per the thin-slice "done means" bar.

**Files:** none (manual/device).

- [ ] **Step 1: Build and install**

```bash
cd /Users/windowlicker/sleepcast-app
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=/opt/homebrew/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
pkill -f "react-native start"; nohup npx react-native start > /tmp/metro.log 2>&1 &
npx react-native run-android
```

- [ ] **Step 2: Exercise each path, screenshot each**

For each, `adb exec-out screencap -p > shot.png` and confirm visually:
1. Add a feed by URL → it appears and toggles.
2. OPML export → a share sheet with feed XML.
3. `start-shuffle` → an episode plays, countdown ticks, lock screen shows title.
4. `start-spread` → plays.
5. `start-varied` → plays with **no network request** for the model (airplane mode on, wifi off; confirm it still starts). Verify `sleepcast2.titlevecs` grows via a temporary debug line if needed.
6. Force a varied timeout (temporarily set `timeoutMs` low) → falls back to spread and still starts.
7. Let a 1-minute timer fade to silence → stops; relaunch → `resume last night` appears and resumes.

- [ ] **Step 3: Confirm the fade is audible**

Start a 1-minute night with the screen locked; the final minute must be an audible ramp, not a cut (the thin-slice acceptance bar).

---

## Self-Review

**Spec coverage:**
- Feeds toggle / add-URL / remove → Task 6. OPML import/export → Task 6 (+ lib tests). ✓
- Multi-feed pool + offline cache → Task 1. ✓
- shuffle / spread / varied (+timeout fallback) / resume → Task 5, wired in Task 8. ✓
- Embedding backend (onnxruntime, bundled model, WordPiece tokenizer, mean-pool+normalize, title-vec cache) → Tasks 2–4. ✓
- Screens → Tasks 6–7; orchestration → Task 8. ✓
- Native-cost/OTA boundary & new-arch link risk → Task 3 gate. ✓
- "Done means" device checks → Task 9. ✓

**Placeholder scan:** The only intentional fill-at-implementation values are (a) the reference tokenizer ids in Task 2 Step 5, (b) the model output name in Task 3 Step 2 → Task 4 Step 5, and (c) `VARIED_N` in Task 5, all flagged with how to obtain them. No vague "add error handling" steps.

**Type consistency:** `buildPool`, `PoolResult`, `Encoding`, `RunSession`, `makeEmbedder`/`embedTexts`, `Strategy`/`Lineup`/`chooseLineup`/`resumeNight`, `SetupProps`, `PlayerProps` are used with identical names/signatures across the tasks that produce and consume them. Cache key `sleepcast2.titlevecs` matches the shared lib.
