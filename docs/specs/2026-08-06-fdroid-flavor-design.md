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

When `process.env.SLEEPCAST_FOSS === "1"`, a `resolver.resolveRequest` rewrites imports of `./features`, `./platform/embed`, and `./youtube/YouTubePlayer` to their `.foss` counterparts. Result: the FOSS bundle contains the stubs, so **`model.onnx`, the vocab, the `onnxruntime` JS, `react-native-youtube-iframe`, and `react-native-webview` JS are never referenced** → none ship in the foss JS bundle/assets. The default (no env) bundle is unchanged (full).

### 3. Gradle flavors + per-variant native strip

Autolinking is **left untouched** (New Arch codegen is fragile to disable — `react-native-webview` ships a `RNCWebViewSpec` codegen module; `onnxruntime-react-native` is a legacy module with no codegen). Instead:

- `android/app/build.gradle`: `flavorDimensions "dist"`; `productFlavors { full { dimension "dist" }; foss { dimension "dist"; applicationIdSuffix ".foss"; versionNameSuffix "-foss" } }`. Both flavors keep autolinking, so `full` is entirely unchanged and the New Arch codegen/registration for every native module is generated exactly as today.
- **onnxruntime prebuilt `.so` strip (the F-Droid blocker):** `onnxruntime-react-native` pulls a prebuilt `com.microsoft.onnxruntime:onnxruntime-android` aar containing `libonnxruntime.so` + `libonnxruntime4j_jni.so`. Strip those from the `foss` APK via AGP's per-variant packaging:
  ```groovy
  androidComponents {
      onVariants(selector().withFlavor("dist", "foss")) { variant ->
          variant.packaging.jniLibs.excludes.add("**/libonnxruntime.so")
          variant.packaging.jniLibs.excludes.add("**/libonnxruntime4j_jni.so")
      }
  }
  ```
  In foss the JS never calls onnxruntime (embed swapped), so the dormant `OnnxruntimeModule` Java class never `dlopen`s the missing `.so` — no crash. Full keeps the `.so`.
- **`react-native-webview` stays autolinked in both flavors.** It's a FOSS library built from source (no prebuilt binary), and foss never navigates to a YouTube URL (JS swapped to the stub, UI gated), so the non-free youtube.com content is never loaded. Leaving it avoids breaking its codegen. No native strip needed.
- **Per-flavor JS bundle env:** the RN gradle plugin's embedded-bundle task for `foss*` variants must run Metro with `SLEEPCAST_FOSS=1` so the resolver swaps. Primary: set the env on the generated `createBundleFoss*JsAndAssets` tasks in an `afterEvaluate`/`tasks.matching` hook. If RN 0.86's bundle task type doesn't accept an env override, **fallback:** a per-foss-variant custom bundle (disable the plugin's auto-bundle for foss, add a task that runs `SLEEPCAST_FOSS=1 npx react-native bundle …` into the variant's assets). The device/APK checks below catch either path failing. The `onnxruntime` patch-package/postinstall stays (harmless).
- **Debug dev-server env (dev-workflow gotcha):** a `fossDebug` build loads JS from the Metro dev server, not an embedded bundle, so **Metro itself** must run with `SLEEPCAST_FOSS=1` (`SLEEPCAST_FOSS=1 npm start`). Otherwise the foss app receives the *full* JS, which `require`s onnxruntime whose `.so` the foss APK stripped → the varied path throws `UnsatisfiedLinkError` (caught by `chooseLineup`, degrading to the `diverseByMeta` fallback — the app still plays, but not via the intended pure-JS embedder). `debuggableVariants = ["fullDebug", "fossDebug"]` is set on the RN `react { }` block so debug variants keep using Metro rather than embedding a bundle.
- `patches/` + `pod install` (iOS) unaffected.

### 4. LICENSE

`LICENSE` (MIT) at the repo root (added in this slice).

## Testing

- **JS:** `features.foss` sets `YOUTUBE=false`; `SetupScreen` with `YOUTUBE=false` (injected/mocked) rejects a YouTube add-URL. `embed.foss.embedTexts` returns L2-normalized `Float32Array[]` (assert unit length; assert two titles sharing words are closer by cosine than two with none — i.e. it produces usable diversity vectors), and `diversePick` over them yields a spread lineup. The `YouTubePlayer.foss` stub renders without importing webview. Existing tests (which run against the full `features`) stay green.
- **Bundle check (CI-ish):** `SLEEPCAST_FOSS=1 npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/foss.jsbundle --assets-dest /tmp/foss-assets` → assert `/tmp/foss-assets` contains **no** `model.onnx` and the bundle string contains no `onnxruntime`/`RNCWebView`. The default bundle DOES contain them.
- **On-device (Pixel 7), BOTH flavors:**
  - `fossDebug`: builds + installs (`com.sleepcastapp.foss`), launches; the APK contains **no** `libonnxruntime.so` / `libonnxruntime4j_jni.so` and **no** 23 MB model (`react-native-webview` native may remain — it's FOSS and dormant); SetupScreen shows shuffle/spread/**varied** (varied now uses the pure-JS embedder — starting it produces a lineup, no crash), a YouTube URL is rejected, and a normal podcast night plays + fades + stops (core intact).
  - `fullDebug`: unchanged — varied-mix + YouTube still work.

## Scope

- **In:** the `foss` Android flavor (the `YOUTUBE` flag, the pure-JS embedder + YouTube stub, metro resolver swap, gradle flavor + per-variant onnxruntime `.so` strip + per-flavor bundle env, side-by-side package id), UI gating of YouTube, the `LICENSE`, and a bundle + two-flavor device check.
- **Out:** the actual F-Droid metadata recipe / repo submission (a separate, out-of-tree process — including whether F-Droid's scanner accepts a maven-pulled onnxruntime aar that's stripped from the APK, vs. requiring the dependency fully absent); reproducible-build hardening; iOS flavoring; making onnxruntime build-from-source; the standing 16 KB `.so` alignment (an onnxruntime concern that the foss flavor sidesteps by stripping onnxruntime, and that the full flavor tracks separately).

## Done means

`./gradlew assembleFossDebug` (or `run-android --mode=fossDebug`) produces `com.sleepcastapp.foss` that installs alongside the full app, launches, plays a podcast night with the full timer/detector/leveling/rest features, offers a **working varied-mix** (pure-JS lexical) but **no YouTube**, and whose APK contains **no** onnxruntime `.so` and **no** MiniLM model — while `full` is byte-for-behaviour unchanged. The repo has a FOSS `LICENSE`.
