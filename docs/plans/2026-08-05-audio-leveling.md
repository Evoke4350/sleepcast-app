# Per-Feed Volume Leveling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each feed play at a volume you set (0.5×–1.5×), folded into the native fade so it works with the screen locked — so a loud show doesn't jolt you awake.

**Architecture:** The shared `effectiveVolume(remaining, fade, trim) = clamp01(fadeVolume × trim)` curve is the source of truth. `scheduleFadeAndStop` (the slice-2 native timer) gains a `trim` param; Android and iOS fold it into the same fade computation via a one-line `effectiveVolume` port. JS passes the current episode's `settings.feedTrim[feedId]`; `SetupScreen` gets a per-feed trim stepper.

**Tech Stack:** React Native 0.86 new-arch TurboModule, Kotlin (ExoPlayer), Swift (AVFoundation), the `vendor/player` `engine`/`leveler` lib, Jest.

## Global Constraints

- Never edit `vendor/player/`. `effectiveVolume`, `nextTrim`, `TRIM_STEPS`, `Settings.feedTrim` are the source of truth — consumed as-is.
- The native fade must fold trim in: `player.volume = effectiveVolume(remaining, fade, trim)` = `clamp01(fadeVolume(remaining, fade) * trim)` each tick, and set `clamp01(trim)` immediately on `scheduleFadeAndStop` (before the first tick). Ports must match the shared math exactly.
- Trim range 0.5..1.5 (`TRIM_STEPS`), absent = 1.0. Adding the `trim` param to the spec regenerates codegen — the Android/iOS overrides must add it or the native build fails (JS tests use a mocked module and pass meanwhile).
- Android env: `JAVA_HOME=/opt/homebrew/opt/openjdk@17`, `ANDROID_HOME=~/Library/Android/sdk`, brew node first. Pixel 7 `2B181FDH2005PD`. iOS: Xcode; `pod install` before building; sim SDK build is the compile gate (device needs unconfigured signing).
- Run JS tests: `PATH=/opt/homebrew/bin:$PATH npx jest <path>`; typecheck `npx tsc --noEmit`. Both stay clean. TDD.

---

### Task 1: Spec `trim` param + App wiring

Add `trim` to the TurboModule spec and pass the current feed's trim when starting a night; update the cosmetic volume readout to `effectiveVolume`.

**Files:**
- Modify: `src/specs/NativeNightAudio.ts`
- Modify: `App.tsx`
- Modify: `__tests__/App.night.test.tsx`

**Interfaces:**
- Spec: `scheduleFadeAndStop(episodeId: string, durationSeconds: number, fadeSeconds: number, trim: number): void;`
- `App` passes `trim = loadState().settings.feedTrim[lead.feedId] ?? 1`.

- [ ] **Step 1: Change the spec**

In `src/specs/NativeNightAudio.ts`, add the `trim` parameter to `scheduleFadeAndStop`:
```ts
scheduleFadeAndStop(episodeId: string, durationSeconds: number, fadeSeconds: number, trim: number): void;
```

- [ ] **Step 2: Write the failing test**

The App test file already mocks `../src/platform/feeds` and `../src/specs/NativeNightAudio` with `freshAudio()` (whose `scheduleFadeAndStop` is a jest.fn). Add:

```tsx
import { loadState, saveState } from "../vendor/player/src/lib/store";

test("start passes the feed's trim to the native timer", async () => {
  mockAudio = freshAudio();
  mockPoolResult = { pool: [{ id: "a", title: "A", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" }], feedTitles: { f: "F" }, errors: [] };
  // give feed "f" a 0.75 trim
  const s = loadState();
  saveState({ ...s, settings: { ...s.settings, feedTrim: { ...s.settings.feedTrim, f: 0.75 } } });
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {});
  await act(async () => { tree.root.findByProps({ testID: "timer-5" }).props.onPress(); });
  await act(async () => { tree.root.findByProps({ testID: "start-shuffle" }).props.onPress(); });
  expect(mockAudio.scheduleFadeAndStop).toHaveBeenCalledWith("a", 300, 60, 0.75);
  act(() => { tree.unmount(); });
});

test("a feed with no trim defaults to 1", async () => {
  mockAudio = freshAudio();
  mockPoolResult = { pool: [{ id: "b", title: "B", url: "https://x/b.mp3", feedId: "g", date: "2024-01-01" }], feedTitles: { g: "G" }, errors: [] };
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {});
  await act(async () => { tree.root.findByProps({ testID: "timer-5" }).props.onPress(); });
  await act(async () => { tree.root.findByProps({ testID: "start-shuffle" }).props.onPress(); });
  expect(mockAudio.scheduleFadeAndStop).toHaveBeenCalledWith("b", 300, 60, 1);
  act(() => { tree.unmount(); });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest __tests__/App.night.test.tsx -t "trim"`
Expected: FAIL — `scheduleFadeAndStop` called with 3 args, not 4.

- [ ] **Step 4: Wire `App.tsx`**

Add `import { effectiveVolume } from "./vendor/player/src/lib/engine";` (alongside the existing `fadeVolume` import), and `loadState` (already imported? if not, add to the `store` import). Add a `trimRef`:
```tsx
const trimRef = useRef(1);
```
In `beginPlayback`, before the `scheduleFadeAndStop` call, compute and store the trim, then pass it:
```tsx
trimRef.current = loadState().settings.feedTrim[lead.feedId] ?? 1;
getNightAudio()?.scheduleFadeAndStop(lead.id, minutes * 60, FADE_SECONDS, trimRef.current);
```
In the 1s interval, change the cosmetic volume readout to fold trim in:
```tsx
setVolume(effectiveVolume(left, FADE_SECONDS, trimRef.current));
```
(Leave the rest-detector `tick` and everything else unchanged; this only changes the displayed `volume` value.)

- [ ] **Step 5: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest __tests__/App.night.test.tsx && PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit`
Expected: PASS; tsc clean. (Existing tests that assert `scheduleFadeAndStop` 3-arg calls must be updated to the 4-arg form — update them to `..., 60, 1`.)

- [ ] **Step 6: Commit**

```bash
git add src/specs/NativeNightAudio.ts App.tsx __tests__/App.night.test.tsx
git commit -m "feat: pass per-feed volume trim to the native fade timer"
```

---

### Task 2: Per-feed trim stepper on `SetupScreen`

Each feed row gets a `−  1.0×  +` stepper that reads, steps (via `nextTrim`), and persists `settings.feedTrim`.

**Files:**
- Modify: `src/screens/SetupScreen.tsx`
- Modify: `src/screens/SetupScreen.test.tsx`

**Interfaces:**
- Consumes `nextTrim`, `TRIM_STEPS` (`vendor/player/src/lib/leveler`); `saveState` (store).
- `testID`s: `trim-down-<id>`, `trim-up-<id>`, `trim-value-<id>`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/SetupScreen.test.tsx — add
import { loadState } from "../../vendor/player/src/lib/store";

test("stepping a feed's trim up persists via nextTrim", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  // built-in "swm" starts at 1.0; one step up → 1.25
  act(() => { find(tree, "trim-up-swm").props.onPress(); });
  expect(loadState().settings.feedTrim.swm).toBe(1.25);
  expect(find(tree, "trim-value-swm").props.children).toContain("1.25");
});
```
(Reuse the file's existing `find(tree, testID)` helper.)

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/SetupScreen.test.tsx -t "trim"`
Expected: FAIL — no `trim-up-swm`.

- [ ] **Step 3: Implement**

In `src/screens/SetupScreen.tsx`, import the stepper helpers:
```tsx
import { nextTrim } from "../../vendor/player/src/lib/leveler";
```
Add a handler:
```tsx
function stepTrim(id: string, dir: 1 | -1) {
  const cur = state.settings.feedTrim[id] ?? 1;
  const next = nextTrim(cur, dir);
  persist({ ...state, settings: { ...state.settings, feedTrim: { ...state.settings.feedTrim, [id]: next } } });
}
```
In each feed row (where the toggle/remove render), add the stepper (a compact row under or beside the title):
```tsx
<View style={s.trimRow}>
  <TouchableOpacity testID={`trim-down-${f.id}`} onPress={() => stepTrim(f.id, -1)} style={s.trimBtn}><Text style={s.trimBtnT}>−</Text></TouchableOpacity>
  <Text testID={`trim-value-${f.id}`} style={s.trimVal}>{`${(state.settings.feedTrim[f.id] ?? 1).toFixed(2)}×`}</Text>
  <TouchableOpacity testID={`trim-up-${f.id}`} onPress={() => stepTrim(f.id, 1)} style={s.trimBtn}><Text style={s.trimBtnT}>+</Text></TouchableOpacity>
</View>
```
Add styles:
```tsx
trimRow: { flexDirection: "row", alignItems: "center", gap: 10 },
trimBtn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, width: 30, height: 30, alignItems: "center", justifyContent: "center" },
trimBtnT: { color: "#d9c9a8", fontSize: 16 },
trimVal: { color: "#8a7a5c", fontSize: 12, minWidth: 44, textAlign: "center" },
```
(`persist` is the existing `SetupScreen` helper that `saveState`s and `setState`s.)

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/SetupScreen.test.tsx`
Expected: PASS (existing SetupScreen tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/screens/SetupScreen.tsx src/screens/SetupScreen.test.tsx
git commit -m "feat: per-feed volume trim stepper on setup"
```

---

### Task 3: Android — fold trim into the native fade

Add the `trim` param and an `effectiveVolume` port; apply it each tick and immediately on schedule.

**Files:**
- Modify: `android/app/src/main/java/com/sleepcastapp/NightAudioModule.kt`
- Modify: `android/app/src/test/java/com/sleepcastapp/FadeCurveTest.kt`

**Interfaces:** consumes the regenerated `NativeNightAudioSpec` (4-arg `scheduleFadeAndStop`).

- [ ] **Step 1: Add the `effectiveVolume` port + failing parity test**

Beside the existing `fadeVolume` (file-level, `internal`):
```kotlin
internal fun effectiveVolume(remainingSeconds: Double, fadeSeconds: Double, trim: Double): Double {
  val v = fadeVolume(remainingSeconds, fadeSeconds) * trim
  return v.coerceIn(0.0, 1.0)
}
```
Add to `FadeCurveTest.kt`:
```kotlin
@Test fun effectiveVolumeMatchesSharedCurve() {
  assertEquals(0.25, effectiveVolume(30.0, 60.0, 0.5), 1e-9)   // 0.5 fade × 0.5 trim
  assertEquals(0.75, effectiveVolume(120.0, 60.0, 0.75), 1e-9) // full × 0.75
  assertEquals(1.0,  effectiveVolume(120.0, 60.0, 1.5), 1e-9)  // clamps to 1
  assertEquals(0.0,  effectiveVolume(0.0, 60.0, 1.5), 1e-9)
}
```
Run: `cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=$HOME/Library/Android/sdk PATH=/opt/homebrew/bin:$PATH ./gradlew :app:testDebugUnitTest --tests "com.sleepcastapp.FadeCurveTest"` — FAIL then PASS.

- [ ] **Step 2: Add the param + apply it**

Change the override signature and store a `fadeTrim`:
```kotlin
private var fadeTrim = 1.0
override fun scheduleFadeAndStop(episodeId: String, durationSeconds: Double, fadeSecs: Double, trim: Double) = runOnMain {
  cancelTimerInternal()
  timerEpisodeId = episodeId
  fadeSeconds = fadeSecs
  fadeTrim = trim
  startedAtElapsed = SystemClock.elapsedRealtime()
  endAtElapsed = startedAtElapsed + (durationSeconds * 1000).toLong()
  player?.volume = trim.coerceIn(0.0, 1.0).toFloat()   // apply immediately, before the first tick
  // …existing tick Runnable, but the volume line becomes:
  //   player?.volume = effectiveVolume(remaining, fadeSeconds, fadeTrim).toFloat()
  // …
}
```
In the tick's `remaining > 0` branch, replace `player?.volume = fadeVolume(remaining, fadeSeconds).toFloat()` with `player?.volume = effectiveVolume(remaining, fadeSeconds, fadeTrim).toFloat()`. Leave the `remaining <= 0` branch (`volume = 0f`, stop, emit) unchanged.

- [ ] **Step 3: Build + install on the Pixel 7**

```bash
cd /Users/windowlicker/sleepcast-app
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=/opt/homebrew/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
pkill -f "react-native start"; nohup npx react-native start > /tmp/metro-s4.log 2>&1 &
npx react-native run-android 2>&1 | tail -15
```
Expected: BUILD SUCCESSFUL, installed, clean launch (screencap). Full audible check is Task 5.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/sleepcastapp/NightAudioModule.kt android/app/src/test/java/com/sleepcastapp/FadeCurveTest.kt
git commit -m "feat(android): fold per-feed trim into the native fade"
```

---

### Task 4: iOS — fold trim into the native fade

Mirror Task 3 in Swift.

**Files:**
- Modify: `ios/SleepcastApp/NightAudioImpl.swift`
- Modify: `ios/SleepcastApp/NightAudio.mm` (4-arg bridge)

**Interfaces:** consumes the regenerated `NativeNightAudioSpec`.

- [ ] **Step 1: Add the `effectiveVolume` port**

Beside the Swift `fadeVolume`:
```swift
func effectiveVolume(_ remainingSeconds: Double, _ fadeSeconds: Double, _ trim: Double) -> Double {
  let v = fadeVolume(remainingSeconds, fadeSeconds) * trim
  return min(1, max(0, v))
}
```
Verify parity with a standalone `xcrun swift` snippet asserting `(30,60,0.5)→0.25`, `(120,60,0.75)→0.75`, `(120,60,1.5)→1`, `(0,60,1.5)→0` (no in-repo XCTest target exists; record the standalone result, as in slice 2).

- [ ] **Step 2: Add the param + apply it**

Add `private var fadeTrim: Double = 1` and change the signature:
```swift
@objc public func scheduleFadeAndStop(_ episodeId: String, durationSeconds: Double, fadeSeconds: Double, trim: Double) {
  cancelTimer()
  timerEpisodeId = episodeId
  fadeSecs = fadeSeconds
  fadeTrim = trim
  startedAt = .now()
  endAt = .now() + durationSeconds
  player?.volume = Float(min(1, max(0, trim)))   // apply immediately
  // …timer as before, but the non-terminal branch's volume line becomes:
  //   self.player?.volume = Float(self.effectiveVolume(remaining, self.fadeSecs, self.fadeTrim))
}
```
In the timer handler's `remaining > 0` path, replace `self.player?.volume = Float(self.fadeVolume(remaining, self.fadeSecs))` with `self.player?.volume = Float(self.effectiveVolume(remaining, self.fadeSecs, self.fadeTrim))`. Leave the `remaining <= 0` branch unchanged.

In `NightAudio.mm`, update the `scheduleFadeAndStop:` bridge method to take and forward the 4th `trim:` (double) argument to `[NightAudioImpl shared]` (match the regenerated spec's method signature — inspect the generated header if unsure).

- [ ] **Step 3: Build for the simulator SDK**

```bash
cd /Users/windowlicker/sleepcast-app/ios && pod install >/dev/null 2>&1
PATH=/opt/homebrew/bin:$PATH xcodebuild build -workspace SleepcastApp.xcworkspace -scheme SleepcastApp -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/s4-ios-dd 2>&1 | grep -aE "BUILD SUCCEEDED|BUILD FAILED| error: " | tail -5
```
Expected: `** BUILD SUCCEEDED **` (proves the Swift + `.mm` conform to the regenerated 4-arg spec).

- [ ] **Step 4: Commit**

```bash
git add ios/SleepcastApp/NightAudioImpl.swift ios/SleepcastApp/NightAudio.mm
git commit -m "feat(ios): fold per-feed trim into the native fade"
```

---

### Task 5: On-device verification (Pixel 7)

- [ ] **Step 1: Build + install HEAD** (as Task 3 Step 3 if not already current).

- [ ] **Step 2: Verify the trim**

1. On setup, step a built-in feed (e.g. Sleep With Me) down to **0.5×** via `trim-down`; confirm the value shows `0.50×`.
2. Start a 5-minute night on that feed; with the phone held, confirm the audio is **audibly quieter** than a normal (1.0×) feed played at the same system volume (relative A/B — trim one feed to 0.5×, another left at 1.0×, compare). The on-screen `vol` should read ~`0.50` before the fade.
3. Let it fade — confirm it still ramps to silence and stops at the timer (trim doesn't break the fade).
4. Relaunch the app; confirm the 0.5× on that feed **persisted**.
5. Screenshot the setup stepper and the player `vol` readout.

---

## Self-Review

**Spec coverage:** trim param on the native timer (Tasks 1, 3, 4) ✓; `effectiveVolume` port + parity test both platforms (3, 4) ✓; App passes the feed's trim (1) ✓; cosmetic volume readout uses `effectiveVolume` (1) ✓; per-feed trim stepper persisting to `settings.feedTrim` (2) ✓; immediate trim application before first tick (3, 4) ✓; fade still reaches 0 at the timer (the `remaining<=0` branch is untouched) ✓; auto-compressor + noise explicitly out of scope ✓; no `vendor/player` edits ✓.

**Placeholder scan:** none — concrete code and commands throughout; the one "inspect the generated header if unsure" (Task 4 `.mm`) mirrors the confirmed slice-2 codegen path and has the parity/build gate to catch a mismatch.

**Type/name consistency:** `scheduleFadeAndStop(episodeId, durationSeconds, fadeSeconds, trim)` is the 4-arg form across the spec, `App.tsx`, and both native modules; `effectiveVolume(r, f, t)` matches the shared `engine.ts` signature; `nextTrim`, `TRIM_STEPS`, `settings.feedTrim`, and the `trim-up/down/value-<id>` testIDs are consistent across tasks.
