# Slice 1 — Feeds, Selection, and Resume

**Status:** design 2026-08-03. First product slice after the thin audio slice
(`2026-07-31-ios-thin-slice-design.md`). Not yet built.

The thin slice proved the native shell: a URL plays, the screen locks for a
full timer, the volume fades to silence, the lock screen shows metadata. This
slice turns that shell into the everyday sleepcast.pro experience: your own
feeds, the four ways of picking what plays, and resuming the night you fell
asleep on.

This is the first of several parity slices. YouTube source, audio
leveling/noise, and the `rest/` sleep detector each get their own spec later.

## Scope

**In:**

- **Feeds.** Toggle the built-in feeds; add/remove custom feeds by URL; import
  and export OPML.
- **Multi-feed pool.** Fetch and parse every enabled feed (native HTTP, no
  relay), assemble one episode pool, cache each feed's XML for offline starts.
- **Selection — all four web strategies:**
  - *shuffle* — `pickNextEpisode`, biased against already-heard.
  - *spread* — `diverseByMeta` (feed × year buckets).
  - *varied mix* — MiniLM title embeddings, `diversePick` across the embedding
    space, with the web's timeout fallback to *spread*.
  - *resume* — restart the **night** (not the episode) from where sleep took
    over.
- **Screens.** A setup screen (feeds + mode + start) and an extracted, polished
  player screen.

**Out (later slices):** the `rest/` sleep detector, night ledger, calibration,
the quarter-hour rule, YouTube source, audio leveling and noise, episode search
UI as a standalone feature (the `episode-search` lib may be used incidentally).

## The seam: reuse everything pure, replace one file

`vendor/player` stays canonical. Every platform-neutral module is reused
**unchanged**, exactly as the website uses it:

- `store.ts` — `loadState`/`saveState`, `addCustomFeed`/`removeCustomFeed`,
  `cacheFeedXml`/`getCachedFeedXml`, `loadPositions`/`rememberPosition`/
  `forgetPosition`, `getPlays`/`recordHeardPlay`, `loadLive`/`saveLive`,
  `loadLastNight`/`saveLastNight`, `recordSessionEnd`, `loadTimerMinutes`.
- `plays.ts` — `pickNextEpisode`, `recordHeard`.
- `positions.ts` — `shouldRemember`, `putPosition`.
- `opml.ts` — `parseOpml`, `buildOpml`.
- `engine.ts` — `diverseByMeta`, `fadeVolume`, `formatTime`, `effectiveVolume`,
  `rearmMinutes`, `parseFeedXml`.
- `semantic-math.ts` — `cosine`, `diversePick`.

These call `localStorage` synchronously, which the MMKV shim
(`src/platform/storage.ts`) already polyfills. They run as-is.

The **only** browser-bound module is `semantic-model.ts`, and only its
inference call — `pipeline(...)` from transformers.js. Its caching half (djb2
hash, int8 quantization, `sleepcast2.titlevecs` in `localStorage`) is
platform-neutral and ports verbatim.

The web React/Astro components (`SleepSetup`, `AppPlayer`, `Player`) are **not**
reused — they are React-DOM. This slice writes native screens against the same
lib.

## New React Native modules

```
src/
  platform/
    embed.ts        embedTexts(texts, onProgress?) → Float32Array[]
    tokenizer.ts    BERT WordPiece tokenizer (bundled vocab.txt)
    feeds.ts        multi-feed fetch → parse → pool, with offline cache
  screens/
    SetupScreen.tsx feeds + mode + start
    PlayerScreen.tsx now-playing (extracted from App.tsx)
  assets/
    minilm/
      model.onnx    all-MiniLM-L6-v2, int8-quantized (~23MB), bundled
      vocab.txt     WordPiece vocabulary
```

### Embedding backend — `onnxruntime-react-native`, bundled, offline

`embedTexts` gets the same signature and cache contract as the web
`semantic-model.ts`, so `diversePick` and the varied-mix flow are unaware of the
swap.

- **Model.** `all-MiniLM-L6-v2`, int8-quantized ONNX, **bundled in the app**.
  No runtime download, no third-party request — first run works offline and in
  iOS Lockdown Mode. This is the deliberate difference from the web, which
  streams the model from Hugging Face on first use.
- **Runtime.** `onnxruntime-react-native` (1.24.x). An `InferenceSession` is
  created lazily on first varied-mix start and held for the process lifetime
  (mirrors the web's lazy `getExtractor`).
- **Tokenizer.** `onnxruntime` gives tensors, not tokenization. A small
  `tokenizer.ts` implements BERT WordPiece against the bundled `vocab.txt`:
  lowercase, basic + WordPiece splitting, `[CLS]`/`[SEP]`, `input_ids` /
  `attention_mask` / `token_type_ids`. All-lowercase MiniLM keeps this to the
  common case; it is tested against known title→id fixtures.
- **Pooling.** Mean-pool the last hidden state over `attention_mask`, then
  L2-normalize — reproducing transformers.js `{ pooling: "mean", normalize:
  true }`. Verified to match reference vectors within tolerance for a fixture
  set.
- **Cache.** Ported verbatim from `semantic-model.ts`: `sleepcast2.titlevecs`,
  djb2 key, int8 quantize, 6000-vector cap. Backed by MMKV via the shim, so a
  title is embedded once ever.
- **Batch cap.** `EMBED_CAP = 96` candidates per run (`diverseByMeta` pre-trims
  the pool), matching the web.

### `feeds.ts` — multi-feed pool

The thin slice fetched one hardcoded feed. This assembles the real pool:

1. `loadState().feeds`, keep `enabled`.
2. For each: fetch XML over native HTTP. On success, `cacheFeedXml`; on network
   failure, fall back to `getCachedFeedXml`.
3. `parseFeedXml(xml, feedId)` per feed, concat into one `Episode[]`.
4. Empty pool (all feeds failed, no cache) surfaces the existing error path.

No relay, no CORS, no SSRF guard — the reason native exists.

## Selection wiring

Ported from `SleepSetup.tsx`, including the exact fallback:

- **shuffle** → `pickNextEpisode(pool, getPlays())` → lead episode.
- **spread** → `diverseByMeta(pool, VARIED_N)`.
- **varied** →
  ```
  const candidates = pool.length > EMBED_CAP ? diverseByMeta(pool, EMBED_CAP) : pool;
  const vecs = await withTimeout(embedTexts(candidates.map(e => e.title)), 25_000);
  return diversePick(vecs, VARIED_N).map(i => candidates[i]);
  // timeout / inference error → startWith(diverseByMeta(pool, VARIED_N), varied=true)
  ```
  The fallback is not decoration: it is the path when embedding is slow or
  fails, and the night must start regardless.
- **resume** → shown only when `loadLastNight()` is rearmable within
  `REARM_WINDOW_MS`. Uses `nextInSpread(lastNight.pool, playedIds)` and
  `positions.ts` to restart the night where sleep took over, at
  `rearmMinutes(previousMinutes)`.

Timer duration (`PlayMode`: minutes / one-episode / all-night) and the fade
loop stay exactly as the thin slice built them.

## Feed management UI

`SetupScreen` sections:

- **Feeds.** Built-ins with a toggle (`enabled`); custom feeds with the same
  toggle plus remove. Add-by-URL calls `addCustomFeed` (which fetches once to
  resolve the title). OPML **import** → `parseOpml` → `addCustomFeed` per entry;
  **export** → `buildOpml(enabledFeeds)` → share sheet / file write.
- **Mode.** Timer preset chips (persisted via `saveTimerMinutes`) and the
  one-episode / all-night toggle.
- **Start.** shuffle · spread · varied · resume (resume conditional).

## Offline and error behavior

- Feeds cache their XML; a fully offline launch starts from cache.
- Varied-mix never blocks a start: 25s timeout or any inference error falls back
  to the spread.
- A feed that 404s or returns non-feed content is dropped from the pool with a
  non-fatal note; other feeds still play.

## Testing

- Shared-lib tests already pass in `vendor/player` — unchanged.
- `tokenizer.ts` — title→`input_ids` fixtures from a reference BERT tokenizer.
- `embed.ts` — cache hit/miss and quantize round-trip with mocked inference;
  pooling/normalization against reference MiniLM vectors within tolerance.
- `feeds.ts` — multi-feed concat; offline cache fallback; all-fail error path.
- OPML round-trip — `parseOpml(buildOpml(x)) ≈ x` (lib already tested; this
  covers the RN import/export wiring).
- Screens — `testID` smoke in the existing style (`start-shuffle`,
  `start-varied`, `feed-toggle-<id>`, `add-feed`, etc.).

## Native cost and OTA boundary

Everything here is pure TypeScript **except** the embedding backend.
`onnxruntime-react-native` plus the bundled model is a **native dependency**:
this slice needs a Mac build and an app-store binary, and cannot ship purely
OTA. That is the direct, accepted cost of including varied-mix in slice 1.
Bundling the model (vs. the web's runtime download) also grows the binary by
~23MB — acceptable for an offline-first, no-third-party-request guarantee.

Once shipped, the pure-TS parts (feeds, selection wiring, resume, OPML, screens)
remain OTA-updatable; only the onnxruntime version or the model file require a
new binary.

## Risks

- **Tokenizer fidelity.** A WordPiece mismatch yields wrong vectors silently.
  Mitigated by fixture tests against a reference tokenizer, and by the fact that
  a bad embedding degrades to "less varied," never to a crash — the spread
  fallback still starts the night.
- **onnxruntime New-Architecture support.** Must be verified on the RN 0.86 new
  arch (bridgeless) build before committing; if it does not link, the fallback
  position is the deferred-varied-mix plan.
- **Binary size / first-launch memory.** A 23MB bundled model and an
  InferenceSession held in memory. Session is created lazily (only on the first
  varied start) and the batch is capped at 96 titles.
- **Inference latency on older devices.** The 25s timeout bounds the worst case;
  the spread fallback is a real path, not theoretical.

## Done means

On a physical device: add a feed by URL and via OPML import; toggle built-ins;
start a night four ways — shuffle, spread, varied mix, and resume-last-night —
each playing a sensible episode; varied mix producing a semantically-spread
lineup offline with no network request, and falling back to the spread when
forced to time out; and OPML export producing a file that re-imports to the same
feeds.
