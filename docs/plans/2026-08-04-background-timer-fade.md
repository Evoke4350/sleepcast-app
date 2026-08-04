# Native Background Timer and Fade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sleep timer, fade, and stop authoritative in the native audio module on both Android and iOS, so a locked-screen night fades and stops on time and resume-after-fade works — fixing the defect slice 1 surfaced.

**Architecture:** The native module gains a self-driven timer (`Handler` on Android, `DispatchSourceTimer` on iOS) that ramps volume via a native port of the shared `fadeVolume` curve and stops at the timer, then emits `onNightEnded`. JS calls `scheduleFadeAndStop` at play time, does its ledger bookkeeping on the `onNightEnded` event (with a reconcile-on-launch fallback for the process-killed case), and keeps its `setInterval` only for the foreground countdown UI.

**Tech Stack:** React Native 0.86 new-arch TurboModule (codegen `EventEmitter`), Kotlin + media3/ExoPlayer (Android), Swift + AVFoundation (iOS), Jest (JS), JUnit (Kotlin parity), XCTest (Swift parity).

## Global Constraints

- Never edit `vendor/player/`; `fadeVolume` stays the single source of the curve. Native ports must match it exactly: `remaining >= fade → 1`, `remaining <= 0 → 0`, else `remaining / fade`.
- New-Architecture TurboModule. The spec is `src/specs/NativeNightAudio.ts` (codegen name `AppSpecs`, java package `com.sleepcastapp.specs`). Adding an `EventEmitter` regenerates native interfaces — the native builds regenerate on compile.
- Android env: `JAVA_HOME=/opt/homebrew/opt/openjdk@17`, `ANDROID_HOME=~/Library/Android/sdk`, brew node first on PATH. Device: Pixel 7 `2B181FDH2005PD`.
- iOS env: Xcode 26.4.1; run `pod install` in `ios/` before building; device: paired iPhone 15 Pro Max. `UIBackgroundModes: audio` already set (verify).
- JS tests: `PATH=/opt/homebrew/bin:$PATH npx jest`; typecheck `npx tsc --noEmit`; both must stay clean.
- The native timer uses a monotonic clock (`SystemClock.elapsedRealtime()` / `DispatchTime`), not wall-clock.
- TDD for JS; native parity ports get a real native unit test; timer behavior is verified on-device.

Run JS tests with: `PATH=/opt/homebrew/bin:$PATH npx jest <path>`.

---

### Task 1: Spec surface + JS timer wiring

Add the timer methods and event to the TurboModule spec, and rewire `App.tsx` so native owns the fade/stop while JS reacts to `onNightEnded`. JS tests mock the native module and simulate the event.

**Files:**
- Modify: `src/specs/NativeNightAudio.ts`
- Modify: `App.tsx`
- Modify: `__tests__/App.night.test.tsx`

**Interfaces:**
- Produces (spec):
  ```ts
  export interface NightEndedEvent { episodeId: string; heardSeconds: number; }
  // added to Spec:
  scheduleFadeAndStop(episodeId: string, durationSeconds: number, fadeSeconds: number): void;
  cancelTimer(): void;
  readonly onNightEnded: EventEmitter<NightEndedEvent>;
  ```
- `App.tsx` consumes `getNightAudio()?.scheduleFadeAndStop(...)`, `?.cancelTimer()`, and subscribes to `onNightEnded`.

- [ ] **Step 1: Add the spec surface**

```ts
// src/specs/NativeNightAudio.ts — add near the top-level imports
import type { EventEmitter } from "react-native/Libraries/Types/CodegenTypes";

// add above `export interface Spec`
export interface NightEndedEvent {
  episodeId: string;
  heardSeconds: number;
}
```
Inside `export interface Spec extends TurboModule { … }`, add:
```ts
  /** Start the authoritative sleep timer. Native fades volume over the final
   *  fadeSeconds and stops at durationSeconds, whether or not JS is awake.
   *  Call once, right after play(). */
  scheduleFadeAndStop(episodeId: string, durationSeconds: number, fadeSeconds: number): void;
  /** Cancel a running timer (manual stop, or starting a new night). */
  cancelTimer(): void;
  /** Fires once when the native timer reaches zero and stops playback. */
  readonly onNightEnded: EventEmitter<NightEndedEvent>;
```

- [ ] **Step 2: Write the failing JS test**

Add to `__tests__/App.night.test.tsx`. Replace the mock of `../src/specs/NativeNightAudio` so `getNightAudio()` returns a stub capturing calls and the event handler:

```tsx
// a mutable stub the tests drive
let mockAudio: any;
jest.mock("../src/specs/NativeNightAudio", () => ({ getNightAudio: () => mockAudio }));

function freshAudio() {
  let endedHandler: ((e: any) => void) | null = null;
  return {
    calls: [] as any[],
    play: jest.fn(async () => {}),
    stop: jest.fn(),
    setVolume: jest.fn(),
    setNowPlaying: jest.fn(),
    scheduleFadeAndStop: jest.fn(function (this: any, ...a: any[]) { this.calls.push(["schedule", ...a]); }),
    cancelTimer: jest.fn(function (this: any) { this.calls.push(["cancel"]); }),
    onNightEnded: (h: (e: any) => void) => { endedHandler = h; return { remove() {} }; },
    fireEnded: (e: any) => endedHandler && endedHandler(e),
  };
}
```

```tsx
test("start schedules the native timer with the episode and fade", async () => {
  mockAudio = freshAudio();
  mockPoolResult = { pool: [{ id: "a", title: "A Quiet Night", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" }], feedTitles: { f: "F" }, errors: [] };
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {});
  await act(async () => { tree.root.findByProps({ testID: "timer-5" }).props.onPress(); });
  await act(async () => { tree.root.findByProps({ testID: "start-shuffle" }).props.onPress(); });
  expect(mockAudio.scheduleFadeAndStop).toHaveBeenCalledWith("a", 300, 60);
  act(() => { tree.unmount(); });
});

test("onNightEnded writes the ledger even though the JS interval never fired", async () => {
  mockAudio = freshAudio();
  mockPoolResult = { pool: [{ id: "a", title: "A Quiet Night", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" }], feedTitles: { f: "F" }, errors: [] };
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {});
  await act(async () => { tree.root.findByProps({ testID: "timer-5" }).props.onPress(); });
  await act(async () => { tree.root.findByProps({ testID: "start-shuffle" }).props.onPress(); });
  await act(async () => { mockAudio.fireEnded({ episodeId: "a", heardSeconds: 300 }); });
  const last = loadLastNight();
  expect(last?.playedIds).toContain("a");
  expect(last?.endedVia).toBe("faded");
  act(() => { tree.unmount(); });
});

test("manual stop cancels the native timer", async () => {
  mockAudio = freshAudio();
  mockPoolResult = { pool: [{ id: "a", title: "A Quiet Night", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" }], feedTitles: { f: "F" }, errors: [] };
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {});
  await act(async () => { tree.root.findByProps({ testID: "timer-5" }).props.onPress(); });
  await act(async () => { tree.root.findByProps({ testID: "start-shuffle" }).props.onPress(); });
  await act(async () => { tree.root.findByProps({ testID: "stop" }).props.onPress(); });
  expect(mockAudio.cancelTimer).toHaveBeenCalled();
  act(() => { tree.unmount(); });
});
```
Remove the old fake-timer "resume-after-fade" test that advanced `setInterval` to `left<=0` — native now owns that path, so the JS interval no longer writes the ledger. The `onNightEnded` test above replaces its coverage.

- [ ] **Step 3: Run tests to verify they fail**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest __tests__/App.night.test.tsx`
Expected: FAIL — `scheduleFadeAndStop`/`onNightEnded` not wired in `App.tsx`.

- [ ] **Step 4: Rewire `App.tsx`**

- Add a subscription effect (near the mount effect):
```tsx
useEffect(() => {
  const sub = getNightAudio()?.onNightEnded((e) => { void onNightEnded(e.episodeId, e.heardSeconds); });
  return () => sub?.remove?.();
}, []);
```
- In `beginPlayback(lead, minutes)`, after `await getNightAudio()?.play(lead.url, 0);` add:
```tsx
  getNightAudio()?.scheduleFadeAndStop(lead.id, minutes * 60, FADE_SECONDS);
```
- Change the JS `setInterval` body so it NO LONGER calls `endSession`/`recordHeardPlay` on `left <= 0`. It only updates UI while foregrounded:
```tsx
  tickRef.current = setInterval(() => {
    const end = endAtRef.current;
    if (end === null) return;
    const left = (end - Date.now()) / 1000;
    if (left <= 0) { stopTick(); return; } // native performs the actual stop
    setVolume(fadeVolume(left, FADE_SECONDS));
    setRemaining(left);
  }, 1000);
```
  (Drop the `getNightAudio()?.setVolume(v)` from the interval too — native drives volume now; the JS interval only reflects it in the UI.)
- Add the native-end handler (this is the bookkeeping that used to live in the interval):
```tsx
  async function onNightEnded(episodeId: string, heardSeconds: number) {
    stopTick();
    endAtRef.current = null;
    const ep = nowRef.current && nowRef.current.id === episodeId ? nowRef.current
      : lineupRef.current.find((e) => e.id === episodeId) ?? nowRef.current;
    if (ep) {
      if (heardSeconds >= HEARD_SEC) {
        recordHeardPlay({ id: ep.id, title: ep.title, feedId: ep.feedId, startedAt: startedAtRef.current, heardSec: heardSeconds });
      }
      if (!playedIdsRef.current.includes(ep.id)) playedIdsRef.current = [...playedIdsRef.current, ep.id];
      saveLastNight({ pool: lineupRef.current, playedIds: playedIdsRef.current, feedTitles: feedTitlesRef.current, artworkByFeedId: {}, skipIntroByFeedId: {}, endedVia: "faded", endedAt: Date.now(), wasVaried: variedRef.current });
    }
    nowRef.current = null;
    setPlaying(false); setNow(null); setRemaining(0); setVolume(1);
  }
```
- Keep `endSession("abandoned")` for manual stop, and call `getNightAudio()?.cancelTimer()` inside it (before `getNightAudio()?.stop()`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest __tests__/App.night.test.tsx && PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/specs/NativeNightAudio.ts App.tsx __tests__/App.night.test.tsx
git commit -m "feat: JS wiring for native sleep timer (schedule, onNightEnded, cancel)"
```

---

### Task 2: Reconcile-on-launch fallback

If the OS kills the process overnight before `onNightEnded` can fire, the ledger is never written. On launch, if a persisted "live night" marker exists and native reports nothing playing, reconcile it.

**Files:**
- Create: `src/logic/nightmarker.ts`
- Test: `src/logic/nightmarker.test.ts`
- Modify: `App.tsx` (write marker on start, reconcile on mount)
- Modify: `__tests__/App.night.test.tsx` (reconcile test)

**Interfaces:**
- Produces:
  ```ts
  interface LiveMarker { episodeId: string; startedAt: number; timerMinutes: number; lineup: Episode[]; playedIds: string[]; feedTitles: Record<string,string>; wasVaried: boolean; }
  function saveMarker(m: LiveMarker): void;
  function loadMarker(): LiveMarker | null;
  function clearMarker(): void;
  function reconcileToLastNight(m: LiveMarker, now: number): void; // writes ledger + lastNight, clears marker
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/logic/nightmarker.test.ts
import "../platform/storage";
import { installLocalStorage } from "../platform/storage";
import { saveMarker, loadMarker, clearMarker, reconcileToLastNight } from "./nightmarker";
import { loadLastNight, getPlays } from "../../vendor/player/src/lib/store";
import type { Episode } from "../../vendor/player/src/lib/engine";

installLocalStorage();
const ep = (id: string): Episode => ({ id, title: id, url: `https://x/${id}.mp3`, feedId: "f", date: "2024-01-01" } as Episode);

test("save/load/clear round-trips the marker", () => {
  const m = { episodeId: "a", startedAt: 1000, timerMinutes: 5, lineup: [ep("a"), ep("b")], playedIds: [], feedTitles: { f: "F" }, wasVaried: false };
  saveMarker(m);
  expect(loadMarker()?.episodeId).toBe("a");
  clearMarker();
  expect(loadMarker()).toBeNull();
});

test("reconcile writes lastNight + a heard play when enough time elapsed, then clears", () => {
  const m = { episodeId: "a", startedAt: 1000, timerMinutes: 5, lineup: [ep("a"), ep("b")], playedIds: [], feedTitles: { f: "F" }, wasVaried: false };
  saveMarker(m);
  reconcileToLastNight(m, 1000 + 5 * 60_000); // a full timer later
  const last = loadLastNight();
  expect(last?.playedIds).toContain("a");
  expect(last?.endedVia).toBe("faded");
  expect(getPlays().some((p) => p.id === "a")).toBe(true);
  expect(loadMarker()).toBeNull(); // cleared
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/logic/nightmarker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/logic/nightmarker.ts
import type { Episode } from "../../vendor/player/src/lib/engine";
import { recordHeardPlay, saveLastNight } from "../../vendor/player/src/lib/store";
import { HEARD_SEC } from "../../vendor/player/src/lib/plays";

export interface LiveMarker {
  episodeId: string; startedAt: number; timerMinutes: number;
  lineup: Episode[]; playedIds: string[]; feedTitles: Record<string, string>; wasVaried: boolean;
}

const KEY = "sleepcast2.livenight";

export function saveMarker(m: LiveMarker): void {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* quota */ }
}
export function loadMarker(): LiveMarker | null {
  try { const raw = localStorage.getItem(KEY); if (!raw) return null; const m = JSON.parse(raw) as LiveMarker; return m?.episodeId ? m : null; } catch { return null; }
}
export function clearMarker(): void { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

// The process died before onNightEnded could fire. Reconstruct the ledger from
// the marker as if the night had faded at its scheduled end.
export function reconcileToLastNight(m: LiveMarker, now: number): void {
  const ep = m.lineup.find((e) => e.id === m.episodeId);
  const heardSec = Math.min(m.timerMinutes * 60, Math.round((now - m.startedAt) / 1000));
  if (ep && heardSec >= HEARD_SEC) {
    recordHeardPlay({ id: ep.id, title: ep.title, feedId: ep.feedId, startedAt: m.startedAt, heardSec });
  }
  const playedIds = m.playedIds.includes(m.episodeId) ? m.playedIds : [...m.playedIds, m.episodeId];
  saveLastNight({ pool: m.lineup, playedIds, feedTitles: m.feedTitles, artworkByFeedId: {}, skipIntroByFeedId: {}, endedVia: "faded", endedAt: now, wasVaried: m.wasVaried });
  clearMarker();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/logic/nightmarker.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `App.tsx`**

- In `beginPlayback`, after scheduling the timer, write the marker:
```tsx
  saveMarker({ episodeId: lead.id, startedAt: startedAtRef.current, timerMinutes: minutes, lineup: lineupRef.current, playedIds: playedIdsRef.current, feedTitles: feedTitlesRef.current, wasVaried: variedRef.current });
```
- In `onNightEnded` and `endSession`, call `clearMarker()` (the night ended cleanly, marker no longer needed).
- In the mount effect, before/after `buildPool`, reconcile a stale marker:
```tsx
  const marker = loadMarker();
  if (marker) {
    const p = getNightAudio()?.isPlaying?.();
    Promise.resolve(p).then((playing) => { if (!playing) reconcileToLastNight(marker, Date.now()); });
  }
```
Add a JS test: seed a marker, mock `getNightAudio().isPlaying` → false, mount `<App/>`, assert `loadLastNight()` is written and the marker cleared.

- [ ] **Step 6: Run full suite + typecheck, commit**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest && PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit`
```bash
git add src/logic/nightmarker.ts src/logic/nightmarker.test.ts App.tsx __tests__/App.night.test.tsx
git commit -m "feat: reconcile a killed night's ledger on next launch"
```

---

### Task 3: Android native timer

Implement `scheduleFadeAndStop`/`cancelTimer`/`onNightEnded` in the Android module, with a Kotlin `fadeVolume` port under a JUnit parity test, and verify the codegen build on the Pixel 7.

**Files:**
- Modify: `android/app/src/main/java/com/sleepcastapp/NightAudioModule.kt`
- Create: `android/app/src/test/java/com/sleepcastapp/FadeCurveTest.kt`

**Interfaces:**
- Consumes the regenerated `NativeNightAudioSpec` (built from Task 1's spec change) — it now declares `scheduleFadeAndStop`, `cancelTimer`, and an event emit method for `onNightEnded`.

- [ ] **Step 1: Add the Kotlin fade port + failing parity test**

```kotlin
// in NightAudioModule.kt (companion or file-level)
internal fun fadeVolume(remainingSeconds: Double, fadeSeconds: Double): Double =
  when {
    remainingSeconds >= fadeSeconds -> 1.0
    remainingSeconds <= 0.0 -> 0.0
    else -> remainingSeconds / fadeSeconds
  }
```

```kotlin
// android/app/src/test/java/com/sleepcastapp/FadeCurveTest.kt
package com.sleepcastapp
import org.junit.Assert.assertEquals
import org.junit.Test
class FadeCurveTest {
  @Test fun matchesSharedCurve() {
    assertEquals(1.0, fadeVolume(120.0, 60.0), 1e-9) // remaining >= fade
    assertEquals(1.0, fadeVolume(60.0, 60.0), 1e-9)
    assertEquals(0.5, fadeVolume(30.0, 60.0), 1e-9)  // linear ramp
    assertEquals(0.0, fadeVolume(0.0, 60.0), 1e-9)
    assertEquals(0.0, fadeVolume(-5.0, 60.0), 1e-9)
  }
}
```
Run: `cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew :app:testDebugUnitTest --tests "com.sleepcastapp.FadeCurveTest"`
Expected: FAIL first (method absent), then PASS after adding `fadeVolume`.

- [ ] **Step 2: Add the timer fields + methods**

```kotlin
// imports
import android.os.Handler
import android.os.Looper
import android.os.SystemClock

// fields
private val timerHandler = Handler(Looper.getMainLooper())
private var timerRunnable: Runnable? = null
private var endAtElapsed = 0L
private var fadeSeconds = 0.0
private var startedAtElapsed = 0L
private var timerEpisodeId = ""

override fun scheduleFadeAndStop(episodeId: String, durationSeconds: Double, fadeSecs: Double) = runOnMain {
  cancelTimerInternal()
  timerEpisodeId = episodeId
  fadeSeconds = fadeSecs
  startedAtElapsed = SystemClock.elapsedRealtime()
  endAtElapsed = startedAtElapsed + (durationSeconds * 1000).toLong()
  val tick = object : Runnable {
    override fun run() {
      val remaining = (endAtElapsed - SystemClock.elapsedRealtime()) / 1000.0
      if (remaining <= 0.0) {
        player?.volume = 0f
        player?.stop()
        val heard = ((SystemClock.elapsedRealtime() - startedAtElapsed) / 1000.0).toInt()
        emitNightEnded(timerEpisodeId, heard)
        cancelTimerInternal()
        return
      }
      player?.volume = fadeVolume(remaining, fadeSeconds).toFloat()
      timerHandler.postDelayed(this, 500)
    }
  }
  timerRunnable = tick
  timerHandler.post(tick)
}

override fun cancelTimer() = runOnMain { cancelTimerInternal() }

private fun cancelTimerInternal() {
  timerRunnable?.let { timerHandler.removeCallbacks(it) }
  timerRunnable = null
}
```
Add `cancelTimerInternal()` to the start of `stop()`.

- [ ] **Step 3: Emit the event**

Wire `emitNightEnded`. With the New-Arch codegen `EventEmitter`, the generated `NativeNightAudioSpec` base provides an emit method (commonly `emitOnNightEnded(WritableMap)`); confirm the exact generated name in `android/app/build/generated/source/codegen/...NativeNightAudioSpec.java` after a build, then:
```kotlin
private fun emitNightEnded(episodeId: String, heardSeconds: Int) {
  val map = Arguments.createMap().apply {
    putString("episodeId", episodeId)
    putInt("heardSeconds", heardSeconds)
  }
  emitOnNightEnded(map) // generated by codegen from the spec's EventEmitter
}
```
If the generated emitter is not exposed as expected, fall back to `RCTDeviceEventEmitter` (`reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("onNightEnded", map)`) and have JS subscribe with `DeviceEventEmitter.addListener("onNightEnded", …)` instead of the codegen event. Record which path you used.

- [ ] **Step 4: Build + install on the Pixel 7**

```bash
cd /Users/windowlicker/sleepcast-app
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=/opt/homebrew/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
pkill -f "react-native start" 2>/dev/null; nohup npx react-native start > /tmp/metro-s2.log 2>&1 &
npx react-native run-android 2>&1 | tail -20
```
Expected: BUILD SUCCESSFUL, installed. (Full device behavior is Task 5.)

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/sleepcastapp/NightAudioModule.kt android/app/src/test/java/com/sleepcastapp/FadeCurveTest.kt
git commit -m "feat(android): native sleep timer with fade, stop, and onNightEnded"
```

---

### Task 4: iOS native timer

Mirror the timer in Swift, with an XCTest fade parity test, and verify the build on the iPhone 15 Pro Max.

**Files:**
- Modify: `ios/SleepcastApp/NightAudioImpl.swift`
- Modify: `ios/SleepcastApp/NightAudio.mm` (bridge the two methods + event)
- Create: `ios/SleepcastAppTests/FadeCurveTests.swift` (or the project's existing test target)

**Interfaces:**
- Consumes the regenerated `NativeNightAudioSpec` (from Task 1). `NightAudio.mm` conforms to it and forwards to `NightAudioImpl`.

- [ ] **Step 1: Add the Swift fade port + failing parity test**

```swift
// NightAudioImpl.swift (file scope or static)
func fadeVolume(_ remainingSeconds: Double, _ fadeSeconds: Double) -> Double {
  if remainingSeconds >= fadeSeconds { return 1 }
  if remainingSeconds <= 0 { return 0 }
  return remainingSeconds / fadeSeconds
}
```
```swift
// ios/SleepcastAppTests/FadeCurveTests.swift
import XCTest
@testable import SleepcastApp
final class FadeCurveTests: XCTestCase {
  func testMatchesSharedCurve() {
    let impl = NightAudioImpl.shared
    XCTAssertEqual(impl.fadeVolume(120, 60), 1, accuracy: 1e-9)
    XCTAssertEqual(impl.fadeVolume(60, 60), 1, accuracy: 1e-9)
    XCTAssertEqual(impl.fadeVolume(30, 60), 0.5, accuracy: 1e-9)
    XCTAssertEqual(impl.fadeVolume(0, 60), 0, accuracy: 1e-9)
    XCTAssertEqual(impl.fadeVolume(-5, 60), 0, accuracy: 1e-9)
  }
}
```
Run (after `pod install`): `cd ios && xcodebuild test -workspace SleepcastApp.xcworkspace -scheme SleepcastApp -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:SleepcastAppTests/FadeCurveTests 2>&1 | tail -20`
Expected: FAIL then PASS.

- [ ] **Step 2: Add the DispatchSourceTimer**

```swift
private var timer: DispatchSourceTimer?
private var endAt: DispatchTime = .now()
private var fadeSecs: Double = 0
private var startedAt: DispatchTime = .now()
private var timerEpisodeId = ""
var onNightEnded: ((String, Int) -> Void)?   // set by NightAudio.mm

@objc public func scheduleFadeAndStop(_ episodeId: String, durationSeconds: Double, fadeSeconds: Double) {
  cancelTimer()
  timerEpisodeId = episodeId
  fadeSecs = fadeSeconds
  startedAt = .now()
  endAt = .now() + durationSeconds
  let t = DispatchSource.makeTimerSource(queue: .main)
  t.schedule(deadline: .now(), repeating: 0.5)
  t.setEventHandler { [weak self] in
    guard let self = self else { return }
    let remaining = (self.endAt.uptimeNanoseconds > DispatchTime.now().uptimeNanoseconds)
      ? Double(self.endAt.uptimeNanoseconds - DispatchTime.now().uptimeNanoseconds) / 1_000_000_000
      : 0
    if remaining <= 0 {
      self.player?.volume = 0
      self.stop()
      let heard = Int(Double(DispatchTime.now().uptimeNanoseconds - self.startedAt.uptimeNanoseconds) / 1_000_000_000)
      self.onNightEnded?(self.timerEpisodeId, heard)
      self.cancelTimer()
      return
    }
    self.player?.volume = Float(self.fadeVolume(remaining, self.fadeSecs))
  }
  timer = t
  t.resume()
}

@objc public func cancelTimer() { timer?.cancel(); timer = nil }
```
Call `cancelTimer()` at the start of `stop()`.

- [ ] **Step 3: Bridge the methods + event in `NightAudio.mm`**

Forward `scheduleFadeAndStop:` and `cancelTimer` to `[NightAudioImpl shared]`, and set `onNightEnded` to emit via the codegen `EventEmitter` (the generated `NativeNightAudioSpecJSI` provides an `emitOnNightEnded`). Confirm the generated emit API and wire `[NightAudioImpl shared].onNightEnded = ^(NSString *id, NSInteger heard){ … emitOnNightEnded … };` in the module's init. Fallback: `RCTDeviceEventEmitter` as on Android. Record the path used.

- [ ] **Step 4: pod install + build on the iPhone**

```bash
cd ios && pod install 2>&1 | tail -5
cd /Users/windowlicker/sleepcast-app
npx react-native run-ios --device "Nate's iPhone" 2>&1 | tail -25
```
Expected: build succeeds and installs on the paired device. (Full behavior is Task 5.) If code signing blocks a device build, fall back to the iPhone 15 simulator for the build-sanity check and note the device run for Task 5.

- [ ] **Step 5: Commit**

```bash
git add ios/SleepcastApp/NightAudioImpl.swift ios/SleepcastApp/NightAudio.mm ios/SleepcastAppTests/FadeCurveTests.swift ios/Podfile.lock
git commit -m "feat(ios): native sleep timer with fade, stop, and onNightEnded"
```

---

### Task 5: On-device verification (both phones)

**Files:** none (manual/device).

- [ ] **Step 1: Android (Pixel 7)** — start a 5-minute night, tap shuffle, **lock the screen** immediately. Confirm: audio keeps playing locked; over the final 60 s it audibly fades; playback **stops at ~5:00** (use `adb shell dumpsys media_session` / `adb logcat` timestamps to confirm stop time and that volume ramped). Unlock → the app offers **resume last night** and resumes. Also verify a manual stop mid-night cancels the timer (audio stops immediately, no later fade).

- [ ] **Step 2: iOS (iPhone 15 Pro Max)** — same sequence: start, lock, confirm fade + stop at the timer with the screen locked, then resume-last-night after unlock.

- [ ] **Step 3: Kill-recovery (either platform)** — start a night, force-stop the app (swipe away / `adb shell am force-stop com.sleepcastapp`) before the timer, relaunch, and confirm the reconcile-on-launch path offers resume (ledger written from the marker).

- [ ] **Step 4: Record results** with screenshots/log excerpts in the task report; note any behavior that couldn't be driven (e.g. keyguard).

---

## Self-Review

**Spec coverage:** native authoritative timer (Tasks 3, 4) ✓; `fadeVolume` ports under parity tests (3, 4) ✓; `scheduleFadeAndStop`/`cancelTimer`/`onNightEnded` spec + JS wiring (1) ✓; bookkeeping via event + reconcile-on-launch (1, 2) ✓; JS interval demoted to UI-only (1) ✓; both-platform device verification (5) ✓; no `vendor/player` edits (Global Constraints) ✓.

**Placeholder scan:** the two intentional implementation-time confirmations are the exact codegen emit-method name (Task 3 Step 3, Task 4 Step 3), each with a concrete fallback (`RCTDeviceEventEmitter`/`DeviceEventEmitter`) and an instruction to record the path. No vague "handle errors" steps.

**Type/name consistency:** `scheduleFadeAndStop(episodeId, durationSeconds, fadeSeconds)`, `cancelTimer()`, `onNightEnded`/`NightEndedEvent {episodeId, heardSeconds}`, `LiveMarker`, `saveMarker`/`loadMarker`/`clearMarker`/`reconcileToLastNight` are used identically across the spec, `App.tsx`, `nightmarker.ts`, and both native modules. The Kotlin/Swift `fadeVolume` match the shared TS signature.
