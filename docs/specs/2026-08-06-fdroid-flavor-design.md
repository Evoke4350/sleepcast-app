# Slice 8 — F-Droid (FOSS) Build Flavor

**Status:** design 2026-08-06. Adds a fully-FOSS Android build alongside the existing full build, so the app can ship on F-Droid. Not yet built.

F-Droid needs a build with no non-free network services, no prebuilt binaries, and a FOSS license. Two blockers today: **YouTube** (non-free embed + tracking + ads) and **varied-mix's embedder** (a prebuilt `onnxruntime` binary + a 23 MB MiniLM model blob). This adds a **`foss`** Android product flavor that excludes both from the *bundle* and the *APK*, not just the UI — while a **`full`** flavor keeps everything. A `LICENSE` (MIT, matching the vendor submodule) is added. iOS keeps the full build (F-Droid is Android-only).

**Varied-mix stays in foss** — only its *embedder* is non-free, not the feature. The vendor `diversePick`/`cosine` operate on any `Float32Array` vectors, so foss swaps the MiniLM embedder for a **pure-JS lexical embedder** (hashed TF-IDF over the title batch). It picks *lexically*-diverse titles (different words) rather than MiniLM's *meaning*-diverse — lower quality, but a real FOSS varied-mix with no model and no native code. So foss drops **only YouTube**.

## What each flavor has

| | `full` (default) | `foss` (F-Droid) |
|---|---|---|
| Feeds + OPML, shuffle/spread/resume | ✓ | ✓ |
| Native timer + locked-screen fade | ✓ | ✓ |
| Sleep detector, leveling, rest extras, a11y | ✓ | ✓ |
| **Varied-mix** | ✓ (MiniLM, semantic) | ✓ (pure-JS TF-IDF, lexical) |
| onnxruntime binary + MiniLM model blob | ✓ | ✗ |
| **YouTube** (react-native-webview embed) | ✓ | ✗ |
| Package id | `com.sleepcastapp` | `com.sleepcastapp.foss` |

## The mechanism

The heavy pieces are pulled into the JS bundle by module-scope `require`s (`embed.ts` → `model.onnx` + `onnxruntime`; `YouTubePlayer.tsx` → `react-native-webview`). Hiding UI is not enough — the FOSS bundle and APK must physically exclude them.

### 1. Feature flag + FOSS variants (JS)

- `src/features.ts` → `export const YOUTUBE = true;` and `src/features.foss.ts` → `export const YOUTUBE = false;`. (Varied-mix needs no flag — it's present in both; only its backend differs, handled by the embed swap.)
- `src/platform/embed.foss.ts` — the **pure-JS lexical embedder**, same `embedTexts(texts, onProgress?) → Promise<Float32Array[]>` signature. Builds a hashed TF-IDF vector per title over the batch: tokenize (lowercase, split on non-alphanumerics), hash each token into a fixed-dim (e.g. 256) `Float32Array` with the hashing trick, weight by `tf * idf` (idf computed across the batch), L2-normalize. Feeds the vendor `diversePick` exactly as MiniLM vectors do — no onnxruntime, no model, no vocab. Also port the title-vector cache? No — TF-IDF is cheap and batch-relative (idf depends on the batch), so it recomputes per run; no `sleepcast2.titlevecs` cache in foss.
- `src/youtube/YouTubePlayer.foss.tsx` — a stub component (never imports `react-native-youtube-iframe`/`react-native-webview`). It renders nothing; foss never routes to a YouTube night, so it's never mounted.
- **UI gating (reads `features`, works in BOTH flavors):** `SetupScreen` rejects YouTube add-URLs with a note when `!YOUTUBE`; `App` never routes to a YouTube night when `!YOUTUBE` (and the resolver swaps `YouTubePlayer` to the stub anyway). Varied-mix UI is unchanged (present in both). In `full`, `YOUTUBE` is true → no change.

### 2. Metro resolver swap (`metro.config.js`)

When `process.env.SLEEPCAST_FOSS === "1"`, a `resolver.resolveRequest` rewrites imports of `./features`, `./platform/embed`, and `./youtube/YouTubePlayer` to their `.foss` counterparts. Result: the FOSS bundle contains the stubs, so **`model.onnx`, the vocab, `onnxruntime`, and `react-native-webview` are never referenced** → none ship in the foss bundle/APK. The default (no env) bundle is unchanged (full).

### 3. Gradle flavors + autolinking exclusion

- `react-native.config.js`: disable Android autolinking for `onnxruntime-react-native` and `react-native-webview` (`dependencies: { '<pkg>': { platforms: { android: null } } }`) so they aren't force-linked into every variant.
- `android/app/build.gradle`: `flavorDimensions "dist"`; `productFlavors { full { dimension "dist" }; foss { dimension "dist"; applicationIdSuffix ".foss"; versionNameSuffix "-foss" } }`. Re-add the two deps **only** to full: `fullImplementation ...onnxruntime...`, `fullImplementation ...react-native-webview...` (matching how autolinking would have added them — resolve the exact `project(':...')`/aar coordinates from `node_modules/.../android`).
- The per-flavor JS bundle: the RN Android `react { }`/bundle task must set `SLEEPCAST_FOSS=1` for the `foss*` variants (via `bundleCommand`/an env on the bundle task, or a `hermesFlags`/`extraPackagerArgs` hook — resolved at implementation time against RN 0.86's gradle plugin). The `onnxruntime` patch-package/postinstall stays (it's harmless in full; foss doesn't link it).
- `patches/` + `pod install` (iOS) unaffected.

### 4. LICENSE

`LICENSE` (MIT) at the repo root (added in this slice).

## Testing

- **JS:** `features.foss` sets `YOUTUBE=false`; `SetupScreen` with `YOUTUBE=false` (injected/mocked) rejects a YouTube add-URL. `embed.foss.embedTexts` returns L2-normalized `Float32Array[]` (assert unit length; assert two titles sharing words are closer by cosine than two with none — i.e. it produces usable diversity vectors), and `diversePick` over them yields a spread lineup. The `YouTubePlayer.foss` stub renders without importing webview. Existing tests (which run against the full `features`) stay green.
- **Bundle check (CI-ish):** `SLEEPCAST_FOSS=1 npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/foss.jsbundle --assets-dest /tmp/foss-assets` → assert `/tmp/foss-assets` contains **no** `model.onnx` and the bundle string contains no `onnxruntime`/`RNCWebView`. The default bundle DOES contain them.
- **On-device (Pixel 7), BOTH flavors:**
  - `fossDebug`: builds + installs (`com.sleepcastapp.foss`), launches; the APK/libs contain **no** `libonnxruntime.so` / `libRNCWebView` and no 23 MB model; SetupScreen shows shuffle/spread/**varied** (varied now uses the pure-JS embedder — starting it produces a lineup, no crash), a YouTube URL is rejected, and a normal podcast night plays + fades + stops (core intact).
  - `fullDebug`: unchanged — varied-mix + YouTube still work.

## Scope

- **In:** the `foss` Android flavor (flags, FOSS stubs, metro resolver swap, gradle flavor + autolinking exclusion + per-flavor bundle env, side-by-side package id), UI gating of varied/YouTube, the `LICENSE`, and a bundle + two-flavor device check.
- **Out:** the actual F-Droid metadata recipe / repo submission (a separate, out-of-tree process); reproducible-build hardening; iOS flavoring; making onnxruntime build-from-source; the standing 16 KB `.so` alignment (an onnxruntime concern that the foss flavor sidesteps by dropping onnxruntime, and that the full flavor tracks separately).

## Done means

`./gradlew assembleFossDebug` (or `run-android --mode=fossDebug`) produces `com.sleepcastapp.foss` that installs alongside the full app, launches, plays a podcast night with the full timer/detector/leveling/rest features, shows **no** varied-mix or YouTube, and whose APK contains **no** onnxruntime `.so`, no `react-native-webview`, and no MiniLM model — while `full` is byte-for-behaviour unchanged. The repo has a FOSS `LICENSE`.
