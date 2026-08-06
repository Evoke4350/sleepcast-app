# F-Droid (FOSS) Build Flavor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `foss` Android product flavor alongside the existing `full` build, so the app can ship on F-Droid — dropping only YouTube, keeping a pure-JS varied-mix, and shipping no prebuilt onnxruntime binary or model blob.

**Architecture:** A build-time module swap. A `SLEEPCAST_FOSS=1` env keys a Metro `resolveRequest` hook that rewrites three modules to `.foss` siblings: a feature flag (`features` → YouTube off), the semantic embedder (`platform/embed` → a pure-JS TF-IDF embedder), and the YouTube player (`youtube/YouTubePlayer` → an inert stub). A Gradle `dist` flavor dimension adds `foss` (suffix package id), strips onnxruntime's prebuilt `.so` from the foss APK via AGP per-variant packaging, and runs the foss embedded-bundle with `SLEEPCAST_FOSS=1`. `full` is untouched. `LICENSE` (MIT) is already committed.

**Tech Stack:** React Native 0.86 (New Architecture, bridgeless), Hermes, TypeScript, Metro, Android Gradle Plugin 8 product flavors, Jest + react-test-renderer.

## Global Constraints

- **New Architecture is mandatory** — never disable it; never disable autolinking (breaks New Arch codegen, e.g. `react-native-webview`'s `RNCWebViewSpec`).
- **Never edit `vendor/player/`** — reuse its pure-TS `diversePick`/`cosine` (`vendor/player/src/lib/semantic-math.ts`) unchanged.
- **foss keeps varied-mix** via a pure-JS lexical embedder; foss drops **only** YouTube.
- **foss must ship no** `libonnxruntime.so`, no `libonnxruntime4j_jni.so`, and no `src/assets/minilm/model.onnx` (23 MB). `react-native-webview` native **may** remain (FOSS, dormant in foss).
- **foss package id** = `com.sleepcastapp.foss` (`applicationIdSuffix ".foss"`, `versionNameSuffix "-foss"`), installs alongside `full` (`com.sleepcastapp`).
- **`full` stays byte-for-behaviour unchanged** — no default-path (no-env) bundle or full-variant APK change.
- The foss embedder returns **L2-normalized** `Float32Array` vectors of a fixed dimension, fed directly to `diversePick`.
- Spec: `docs/specs/2026-08-06-fdroid-flavor-design.md`.

---

### Task 1: Feature flags (`features.ts` + `features.foss.ts`)

**Files:**
- Create: `src/features.ts`
- Create: `src/features.foss.ts`
- Test: `src/features.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `import * as features from "./features"` exposing `export const YOUTUBE: boolean`. Full = `true`; the `.foss` sibling = `false`. The Metro resolver (Task 5) swaps `features` → `features.foss` under `SLEEPCAST_FOSS=1`. Consumed by SetupScreen/App (Task 4).

- [ ] **Step 1: Write the failing test**

```ts
// src/features.test.ts
import * as full from "./features";
import * as foss from "./features.foss";

test("full build enables YouTube", () => {
  expect(full.YOUTUBE).toBe(true);
});

test("foss build disables YouTube", () => {
  expect(foss.YOUTUBE).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/features.test.ts`
Expected: FAIL — cannot find module `./features`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features.ts
// Build-flavor feature flags. The Metro resolver (metro.config.js) swaps this
// module for ./features.foss when SLEEPCAST_FOSS=1, turning YouTube off for the
// F-Droid build. Varied-mix needs no flag — it's present in both flavors; only
// its embedder backend differs (see platform/embed vs platform/embed.foss).
export const YOUTUBE = true;
```

```ts
// src/features.foss.ts
// FOSS-flavor flags (see ./features). YouTube is dropped: its embed is a
// non-free network service with tracking + ads.
export const YOUTUBE = false;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/features.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features.ts src/features.foss.ts src/features.test.ts
git commit -m "Add build-flavor feature flags (YouTube on/off)"
```

---

### Task 2: Pure-JS TF-IDF embedder (`platform/embed.foss.ts`)

**Files:**
- Create: `src/platform/embed.foss.ts`
- Test: `src/platform/embed.foss.test.ts`

**Interfaces:**
- Consumes: nothing (pure JS; no onnxruntime, no model, no `localStorage` cache).
- Produces: `export async function embedTexts(texts: string[], onProgress?: (done: number, total: number) => void): Promise<Float32Array[]>` — the SAME signature as `src/platform/embed.ts`'s `embedTexts`. Returns one L2-normalized `Float32Array` (length 256) per input, suitable for `diversePick`. The Metro resolver (Task 5) swaps `platform/embed` → `platform/embed.foss` under `SLEEPCAST_FOSS=1`. Consumed by `src/logic/selection.ts` (`chooseLineup` "varied", already wired via `import { embedTexts as prodEmbed } from "../platform/embed"`).

- [ ] **Step 1: Write the failing test**

```ts
// src/platform/embed.foss.test.ts
import { embedTexts } from "./embed.foss";
import { cosine, diversePick } from "../../vendor/player/src/lib/semantic-math";

test("returns one L2-normalized vector per title", async () => {
  const vecs = await embedTexts(["calm sleep meditation", "quantum physics lecture"]);
  expect(vecs).toHaveLength(2);
  for (const v of vecs) {
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  }
});

test("titles sharing words are closer than disjoint titles", async () => {
  const [a, b, c] = await embedTexts([
    "calm sleep meditation",
    "calm sleep stories",
    "quantum physics lecture",
  ]);
  expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
});

test("feeds diversePick to yield N distinct picks", async () => {
  const titles = ["ocean waves", "rain forest", "city hum", "deep space", "warm fire"];
  const vecs = await embedTexts(titles);
  const picks = diversePick(vecs, 3, () => 0);
  expect(new Set(picks).size).toBe(3);
});

test("reports progress once per title, ending at (N, N)", async () => {
  const calls: Array<[number, number]> = [];
  await embedTexts(["a title", "b title", "c title"], (d, t) => calls.push([d, t]));
  expect(calls).toHaveLength(3);
  expect(calls[calls.length - 1]).toEqual([3, 3]);
});

test("empty input returns empty array", async () => {
  expect(await embedTexts([])).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/platform/embed.foss.test.ts`
Expected: FAIL — cannot find module `./embed.foss`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/platform/embed.foss.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/platform/embed.foss.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/platform/embed.foss.ts src/platform/embed.foss.test.ts
git commit -m "Add pure-JS TF-IDF embedder for the FOSS varied-mix"
```

---

### Task 3: Inert YouTube player stub (`youtube/YouTubePlayer.foss.tsx`)

**Files:**
- Create: `src/youtube/YouTubePlayer.foss.tsx`
- Test: `src/youtube/YouTubePlayer.foss.test.tsx`
- Read for the exact prop + handle types: `src/youtube/YouTubePlayer.tsx` (top of file — the `Props` and `YouTubePlayerHandle` exports).

**Interfaces:**
- Consumes: the real component's public types. `YouTubePlayer.tsx` exports `type YouTubePlayerHandle` and a default `forwardRef` component. Import the type only (`import type { YouTubePlayerHandle } from "./YouTubePlayer"`) — a type import erases at build time, so it pulls no webview code into the foss bundle.
- Produces: `export type YouTubePlayerHandle` (re-exported) and a default component with the same props, rendering `null`, so a stale reference type-checks. It must NOT import `react-native-youtube-iframe` or any runtime value from `react-native-webview` — that is the whole point (keeps `YoutubeIframe`/webview JS out of the foss bundle). foss never routes to a YouTube night, so it is never mounted; the file exists only for the resolver to swap in.

- [ ] **Step 1: Write the failing test**

```tsx
// src/youtube/YouTubePlayer.foss.test.tsx
import React from "react";
import TestRenderer from "react-test-renderer";
import YouTubePlayer from "./YouTubePlayer.foss";

test("foss YouTube stub renders nothing and pulls no webview", () => {
  let tree: TestRenderer.ReactTestRenderer;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<YouTubePlayer ref={React.createRef()} />);
  });
  expect(tree!.toJSON()).toBeNull();
});

test("foss stub source imports no youtube-iframe / webview runtime", () => {
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "YouTubePlayer.foss.tsx"),
    "utf8"
  );
  expect(src).not.toMatch(/from ["']react-native-youtube-iframe["']/);
  // a value import of webview; the type-only `import type ... webview` is fine
  expect(src).not.toMatch(/^import [^t].*from ["']react-native-webview["']/m);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/youtube/YouTubePlayer.foss.test.tsx`
Expected: FAIL — cannot find module `./YouTubePlayer.foss`.

- [ ] **Step 3: Write minimal implementation**

First open `src/youtube/YouTubePlayer.tsx` and copy the exact `Props`/handle shape. Then:

```tsx
// src/youtube/YouTubePlayer.foss.tsx
//
// Inert FOSS stand-in for YouTubePlayer.tsx. The FOSS build drops YouTube, and
// the Metro resolver swaps this in so the real component's react-native-youtube-
// iframe / react-native-webview JS never enters the bundle. foss never routes to
// a YouTube night (SetupScreen rejects YouTube URLs, App gates the route), so
// this is never mounted — it exists only to satisfy the swap and type-check any
// stale references. Renders nothing.
import React, { forwardRef } from "react";
import type { YouTubePlayerHandle } from "./YouTubePlayer";

export type { YouTubePlayerHandle } from "./YouTubePlayer";

// Accept any props the real component takes; ignore them.
const YouTubePlayerFoss = forwardRef<YouTubePlayerHandle, Record<string, unknown>>(
  function YouTubePlayerFoss(_props, _ref) {
    return null;
  }
);

export default YouTubePlayerFoss;
```

> If `src/youtube/YouTubePlayer.tsx` does NOT export `type YouTubePlayerHandle`, instead define a local `export type YouTubePlayerHandle = Record<string, never>;` here and drop the type import — the stub is never called, so an empty handle is sufficient. Adjust to whatever makes `tsc` pass.

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `npx jest src/youtube/YouTubePlayer.foss.test.tsx && npx tsc --noEmit`
Expected: PASS (2 tests); `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/youtube/YouTubePlayer.foss.tsx src/youtube/YouTubePlayer.foss.test.tsx
git commit -m "Add inert YouTube player stub for the FOSS build"
```

---

### Task 4: Gate YouTube in the UI on the feature flag

**Files:**
- Modify: `src/screens/SetupScreen.tsx` (imports; `addFeed` at lines ~49-63)
- Modify: `App.tsx` (the `onStart` route guard at lines ~285-289)
- Test: `src/screens/SetupScreen.youtube-gate.test.tsx` (new)

**Interfaces:**
- Consumes: `import { YOUTUBE } from "../features"` (Task 1) in SetupScreen; `import { YOUTUBE } from "./features"` in App. Under the resolver swap these become `features.foss` (`YOUTUBE === false`).
- Produces: no new exports. Behavior: when `!YOUTUBE`, a YouTube add-URL is rejected with a note (SetupScreen) and no YouTube night can be routed (App). In `full` (`YOUTUBE === true`), both paths are unchanged.

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/SetupScreen.youtube-gate.test.tsx
import React from "react";
import TestRenderer from "react-test-renderer";

jest.mock("../features", () => ({ YOUTUBE: false }));
// Fail loudly if the gate lets a YouTube URL reach the resolver network call:
jest.mock("../platform/youtube-add", () => ({
  resolveYouTubeFeedUrl: jest.fn(() => {
    throw new Error("resolveYouTubeFeedUrl must not be called when YOUTUBE is off");
  }),
}));

import SetupScreen from "./SetupScreen";
import { resolveYouTubeFeedUrl } from "../platform/youtube-add";

function findByTestID(node: any, id: string): any {
  return node.root.findAll((n: any) => n.props?.testID === id)[0];
}

test("with YouTube off, a YouTube URL is rejected and never resolved", () => {
  let tr: TestRenderer.ReactTestRenderer;
  TestRenderer.act(() => {
    tr = TestRenderer.create(
      <SetupScreen onStart={() => {}} onResume={() => {}} resumeAvailable={false} onOpenRest={() => {}} />
    );
  });
  const input = findByTestID(tr!, "feed-url-input"); // confirm this testID in SetupScreen; use the actual one
  TestRenderer.act(() => input.props.onChangeText("https://youtube.com/@LofiGirl"));
  const addBtn = findByTestID(tr!, "add-feed");
  TestRenderer.act(() => addBtn.props.onPress());

  expect(resolveYouTubeFeedUrl).not.toHaveBeenCalled();
  const err = tr!.root.findAll((n: any) => n.props?.testID === "feed-error")[0];
  expect(err.props.children).toMatch(/youtube/i);
});
```

> Before writing the impl, open `src/screens/SetupScreen.tsx` and confirm the TextInput's `testID` (the plan's grep showed `accessibilityLabel="feed URL"` and `testID="add-feed"`; use the input's real `testID`, and the real `feed-error` testID). Fix the test's ids to match.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/SetupScreen.youtube-gate.test.tsx`
Expected: FAIL — `resolveYouTubeFeedUrl` IS called (gate not yet added), or no matching feed-error.

- [ ] **Step 3: Write minimal implementation**

In `src/screens/SetupScreen.tsx`, add the import near the other imports:

```tsx
import { YOUTUBE } from "../features";
```

Then in `addFeed`, gate the YouTube branch — replace the existing `if (youtubeFeedUrl(trimmed)) {` block's entry:

```tsx
    if (youtubeFeedUrl(trimmed)) {
      if (!YOUTUBE) {
        setFeedError("YouTube isn't available in this build");
        return;
      }
      const resolved = await resolveYouTubeFeedUrl(trimmed);
```

In `App.tsx`, add the import near the top:

```tsx
import { YOUTUBE } from "./features";
```

Then guard the `onStart` YouTube route (defense-in-depth; foss can't create a YT lineup anyway):

```tsx
    if (YOUTUBE && isYouTubeLineup([r.lead])) {
      const trim = loadState().settings.feedTrim[r.lead.feedId] ?? 1;
      setYtSession({ lineup: r.lineup, minutes, trim });
      return;
    }
```

(Leave the `onResume` YouTube block as-is — its comment already notes it is currently unreachable.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/SetupScreen.youtube-gate.test.tsx && npx tsc --noEmit`
Expected: PASS; `tsc` clean.

- [ ] **Step 5: Run the existing SetupScreen/App suites (unchanged full behavior)**

Run: `npx jest SetupScreen App`
Expected: PASS — existing tests (which import the real `features`, `YOUTUBE===true`) are unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/screens/SetupScreen.tsx App.tsx src/screens/SetupScreen.youtube-gate.test.tsx
git commit -m "Gate YouTube add-URL and night route on the YOUTUBE feature flag"
```

---

### Task 5: Metro resolver swap + FOSS bundle assertion

**Files:**
- Modify: `metro.config.js`
- Test: `metro.config.test.js` (new)

**Interfaces:**
- Consumes: `process.env.SLEEPCAST_FOSS`. The `.foss` sibling files from Tasks 1-3 must already exist.
- Produces: when `SLEEPCAST_FOSS === "1"`, Metro resolves `src/features.ts` → `src/features.foss.ts`, `src/platform/embed.ts` → `src/platform/embed.foss.ts`, and `src/youtube/YouTubePlayer.tsx` → `src/youtube/YouTubePlayer.foss.tsx`. Matching is on the RESOLVED absolute `filePath` suffix (robust to each importer's relative path). Without the env, resolution is unchanged.

- [ ] **Step 1: Write the failing test**

```js
// metro.config.test.js
const path = require("path");

function fakeContext(filePath) {
  return { resolveRequest: () => ({ type: "sourceFile", filePath }) };
}
function loadConfig() {
  delete require.cache[require.resolve("./metro.config.js")];
  return require("./metro.config.js");
}
const abs = (p) => path.join(__dirname, p);

afterEach(() => { delete process.env.SLEEPCAST_FOSS; });

test("swaps the three modules to .foss when SLEEPCAST_FOSS=1", () => {
  process.env.SLEEPCAST_FOSS = "1";
  const { resolver } = loadConfig();
  const cases = [
    ["src/features.ts", "src/features.foss.ts"],
    ["src/platform/embed.ts", "src/platform/embed.foss.ts"],
    ["src/youtube/YouTubePlayer.tsx", "src/youtube/YouTubePlayer.foss.tsx"],
  ];
  for (const [from, to] of cases) {
    const res = resolver.resolveRequest(fakeContext(abs(from)), "irrelevant", "android");
    expect(res.filePath).toBe(abs(to));
  }
});

test("leaves resolution unchanged without the env", () => {
  const { resolver } = loadConfig();
  const res = resolver.resolveRequest(fakeContext(abs("src/features.ts")), "x", "android");
  expect(res.filePath).toBe(abs("src/features.ts"));
});

test("does not touch unrelated modules even under foss", () => {
  process.env.SLEEPCAST_FOSS = "1";
  const { resolver } = loadConfig();
  const res = resolver.resolveRequest(fakeContext(abs("src/logic/selection.ts")), "x", "android");
  expect(res.filePath).toBe(abs("src/logic/selection.ts"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest metro.config.test.js`
Expected: FAIL — `resolver.resolveRequest` is undefined (not yet added).

- [ ] **Step 3: Write minimal implementation**

Replace `metro.config.js` with:

```js
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

// FOSS build swap: when SLEEPCAST_FOSS=1, rewrite three modules to their .foss
// siblings so the bundle contains the pure-JS embedder + YouTube stub instead of
// onnxruntime + the 23 MB model + the webview/youtube-iframe player. Matching is
// on the resolved absolute path suffix, so every importer's relative path is
// covered. See docs/specs/2026-08-06-fdroid-flavor-design.md.
const FOSS_SWAPS = [
  [path.join('src', 'features.ts'), path.join('src', 'features.foss.ts')],
  [path.join('src', 'platform', 'embed.ts'), path.join('src', 'platform', 'embed.foss.ts')],
  [path.join('src', 'youtube', 'YouTubePlayer.tsx'), path.join('src', 'youtube', 'YouTubePlayer.foss.tsx')],
];

function fossResolveRequest(context, moduleName, platform) {
  const res = context.resolveRequest(context, moduleName, platform);
  if (process.env.SLEEPCAST_FOSS === '1' && res && res.type === 'sourceFile') {
    for (const [from, to] of FOSS_SWAPS) {
      if (res.filePath.endsWith(from)) {
        return { ...res, filePath: res.filePath.slice(0, -from.length) + to };
      }
    }
  }
  return res;
}

const config = {
  resolver: {
    // .onnx (MiniLM model) and .txt (its vocab) ship as bundled assets.
    assetExts: [...defaultConfig.resolver.assetExts, 'onnx', 'txt'],
    resolveRequest: fossResolveRequest,
  },
};

module.exports = mergeConfig(defaultConfig, config);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest metro.config.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Assert the real FOSS bundle excludes onnxruntime + model + webview**

Run:
```bash
SLEEPCAST_FOSS=1 npx react-native bundle --platform android --dev false \
  --entry-file index.js --bundle-output /tmp/foss.jsbundle --assets-dest /tmp/foss-assets
# Expect: no model asset, and no onnxruntime / webview / youtube-iframe strings.
find /tmp/foss-assets -name 'model.onnx' | tee /tmp/foss-model.txt
grep -c -E 'onnxruntime|RNCWebView|youtube-iframe|InferenceSession' /tmp/foss.jsbundle || true
```
Expected: `/tmp/foss-model.txt` is EMPTY (no model), and the grep count is `0`.

Then confirm the DEFAULT (full) bundle DOES contain them:
```bash
npx react-native bundle --platform android --dev false \
  --entry-file index.js --bundle-output /tmp/full.jsbundle --assets-dest /tmp/full-assets
find /tmp/full-assets -name 'model.onnx'   # expect: the model IS present
```
Expected: the model IS present in `/tmp/full-assets`.

- [ ] **Step 6: Commit**

```bash
git add metro.config.js metro.config.test.js
git commit -m "Swap features/embed/YouTube to .foss variants under SLEEPCAST_FOSS"
```

---

### Task 6: Gradle `foss` flavor — package id, onnxruntime `.so` strip, per-flavor bundle env

**Files:**
- Modify: `android/app/build.gradle` (add `flavorDimensions`/`productFlavors` in the `android { }` block; add the `androidComponents { }` block; add the foss-bundle env hook)
- Read: `android/app/build.gradle` (the `android { }` block, `defaultConfig`, `buildTypes` at ~line 102) and `android/gradle.properties` to confirm New Arch/Hermes.

**Interfaces:**
- Consumes: the `.foss` files + resolver from Tasks 1-5.
- Produces: two build variants per build type — `full*` (id `com.sleepcastapp`) and `foss*` (id `com.sleepcastapp.foss`). `foss` APKs are built with `SLEEPCAST_FOSS=1` (embedded JS bundle uses the swap) and strip `libonnxruntime.so` + `libonnxruntime4j_jni.so`.

- [ ] **Step 1: Add the flavor dimension + product flavors**

In `android/app/build.gradle`, inside `android { ... }` (after `defaultConfig { }`), add:

```groovy
    flavorDimensions "dist"
    productFlavors {
        full {
            dimension "dist"
            // default package id (com.sleepcastapp) — unchanged
        }
        foss {
            dimension "dist"
            applicationIdSuffix ".foss"
            versionNameSuffix "-foss"
        }
    }
```

- [ ] **Step 2: Strip onnxruntime's prebuilt `.so` from foss variants**

In `android/app/build.gradle`, at the TOP LEVEL of the file (outside `android { }`, e.g. just after it), add:

```groovy
// The foss flavor must ship no prebuilt onnxruntime binary. onnxruntime-react-
// native pulls a prebuilt onnxruntime-android aar (libonnxruntime.so +
// libonnxruntime4j_jni.so). Strip them from the foss APK; foss's JS never calls
// onnxruntime (embed swapped to the pure-JS embedder), so the dormant Java class
// never dlopens the missing .so. full keeps them. See the design doc.
androidComponents {
    onVariants(selector().withFlavor("dist", "foss")) { variant ->
        variant.packaging.jniLibs.excludes.add("**/libonnxruntime.so")
        variant.packaging.jniLibs.excludes.add("**/libonnxruntime4j_jni.so")
    }
}
```

- [ ] **Step 3: Run the foss embedded bundle with `SLEEPCAST_FOSS=1`**

The RN gradle plugin generates a JS-bundle task per non-debuggable variant (`createBundleFoss<BuildType>JsAndAssets`). Set the env on the foss ones. Add at the top level of `android/app/build.gradle`:

```groovy
// Ensure the foss variants' embedded JS bundle runs Metro with the FOSS swap.
afterEvaluate {
    tasks.matching { it.name =~ /^createBundleFoss.*JsAndAssets$/ }.configureEach {
        if (it.hasProperty("environment")) {
            it.environment("SLEEPCAST_FOSS", "1")
        }
    }
}
```

If the task type does NOT expose `environment` (RN 0.86's `BundleHermesCTask` may not), the `hasProperty` guard makes this a silent no-op — Step 6's APK check will catch a full-content foss bundle. In that case, apply the **fallback**: set the env process-wide for the build invocation instead — document that foss release builds are produced via `SLEEPCAST_FOSS=1 ./gradlew assembleFossRelease` (the env is inherited by the plugin's Metro exec). Verify which path works in Step 6 and keep whichever the check passes with; note the choice in the task report.

- [ ] **Step 4: Build both debug variants**

Run:
```bash
cd android && ./gradlew assembleFullDebug assembleFossDebug -x lint 2>&1 | tail -30
```
Expected: BUILD SUCCESSFUL; both APKs produced under `android/app/build/outputs/apk/`.

- [ ] **Step 5: Assert package ids install side by side**

Run:
```bash
"$ANDROID_HOME/build-tools/"*/aapt2 dump packagename android/app/build/outputs/apk/foss/debug/app-foss-debug.apk 2>/dev/null || \
  unzip -p android/app/build/outputs/apk/foss/debug/app-foss-debug.apk AndroidManifest.xml | strings | grep -o 'com.sleepcastapp[.a-z]*' | head
```
Expected: `com.sleepcastapp.foss`. The full APK stays `com.sleepcastapp`.

- [ ] **Step 6: Assert the foss APK excludes onnxruntime + the model; full includes them**

Run:
```bash
FOSS=android/app/build/outputs/apk/foss/debug/app-foss-debug.apk
FULL=android/app/build/outputs/apk/full/debug/app-full-debug.apk
echo "foss libonnxruntime (expect none):";  unzip -l "$FOSS" | grep -c 'libonnxruntime' || true
echo "foss model.onnx (expect none):";       unzip -l "$FOSS" | grep -c 'model.onnx'    || true
echo "full libonnxruntime (expect >0):";     unzip -l "$FULL" | grep -c 'libonnxruntime' || true
echo "full model.onnx (expect >0):";         unzip -l "$FULL" | grep -c 'model.onnx'     || true
```
Expected: foss counts `0` and `0`; full counts `>0` and `>0`. If foss shows the model, Step 3's env did not reach Metro — apply the Step 3 fallback and rebuild.

- [ ] **Step 7: On-device verification (Pixel 7, GrapheneOS)**

```bash
adb install -r android/app/build/outputs/apk/foss/debug/app-foss-debug.apk
adb shell monkey -p com.sleepcastapp.foss -c android.intent.category.LAUNCHER 1
```
Verify by hand (or `uiautomator dump`): app launches; SetupScreen shows shuffle/spread/**varied**; adding a `youtube.com/@…` URL shows "YouTube isn't available in this build"; starting **varied** produces a lineup and plays (no crash — the pure-JS embedder ran); a normal podcast night plays, fades, and stops. Then `adb install -r` the full APK (`com.sleepcastapp`) and confirm varied-mix + YouTube still work — both apps coexist.

- [ ] **Step 8: Commit**

```bash
git add android/app/build.gradle
git commit -m "Add foss Gradle flavor: package id, onnxruntime .so strip, FOSS bundle env"
```

---

## Self-Review

**Spec coverage:**
- FOSS license → already committed (`LICENSE`), noted in Global Constraints.
- `foss` flavor + `full` kept → Task 6.
- Drop YouTube (bundle + APK) → Tasks 1, 3, 4, 5 (JS swap + UI gate) — webview native intentionally retained per spec.
- Keep varied-mix via pure-JS embedder → Task 2 + Task 5 swap.
- No onnxruntime `.so` / no model in foss → Task 5 (bundle assets) + Task 6 Steps 2/6 (APK).
- Package id side-by-side → Task 6 Steps 1/5.
- `full` unchanged → resolver is a no-op without the env (Task 5); flavors leave full's deps/autolinking/codegen untouched (Task 6); verified full bundle/APK still carry the model + `.so`.
- Two-flavor device check → Task 6 Step 7.

**Placeholder scan:** none — every code step carries complete code; the two acknowledged unknowns (SetupScreen `testID` names in Task 4; the bundle-env task-type in Task 6 Step 3) are handled with explicit "confirm the real id" / fallback instructions plus a verification step that catches a wrong guess.

**Type consistency:** `embedTexts(texts, onProgress?)` matches `src/platform/embed.ts` exactly (verified against the file) so the `selection.ts` swap type-checks. `YOUTUBE` is a `boolean` const in both feature modules. `YouTubePlayerHandle` re-exported from the real component (Task 3 has a fallback if that type isn't exported).

## Execution Handoff

Plan complete and saved to `docs/plans/2026-08-06-fdroid-flavor.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session with checkpoints for review.
