# Sleep Detector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Observe each night with the ported `rest/` sleep detector, record it to the local ledger, and show a history screen with a self-label that calibrates the detector — without ever shortening a night.

**Architecture:** The whole `rest/` engine is reused unchanged (MMKV-backed `localStorage`). `App.tsx` owns a `RestSession` per night: constructed at play, fed `tick({hidden, fadingOrDone})` on the existing 1s interval and `noteInteraction()` on player touches, finished into `appendNight` when the night ends. A new native `RestScreen` reads the ledger and offers the self-label calibration loop.

**Tech Stack:** React Native 0.86, TypeScript, the `vendor/player` `rest/` lib, Jest + react-test-renderer.

## Global Constraints

- Never edit `vendor/player/`; the detector, ledger, and calibration are consumed as-is. Ledger keys are the lib's own (`sleepcast2.rest.*`).
- The detector is **observational** — it must NOT end or shorten a night. The slice-2 native timer still governs playback end.
- `fadingOrDone` for the tick is `remaining <= FADE_SECONDS` (FADE_SECONDS = 60, already in `App.tsx`). `hidden` is `AppState.currentState !== "active"`.
- Interaction = any touch on the player surface (RN adaptation of the web's transport-touch signal), observed without consuming the touch.
- Run tests: `PATH=/opt/homebrew/bin:$PATH npx jest <path>`; typecheck `npx tsc --noEmit`. Both stay clean. TDD.

---

### Task 1: RestSession night wiring in `App.tsx`

Construct a `RestSession` per night, tick it from the interval, and finish it into the ledger when the night ends. Also append a minimal night on kill-recovery.

**Files:**
- Modify: `App.tsx`
- Modify: `src/logic/nightmarker.ts` (append a `detector:"none"` night on reconcile)
- Modify: `__tests__/App.night.test.tsx`
- Modify: `src/logic/nightmarker.test.ts`

**Interfaces:**
- Consumes: `RestSession` (`vendor/player/src/lib/rest/session`), `appendNight`, `loadNights` (`vendor/player/src/lib/rest/ledger`), `AppState` (react-native).
- Produces: `App` behavior — `restRef` fed and finished; no exported change.

- [ ] **Step 1: Write the failing test**

Add to `__tests__/App.night.test.tsx` (the file already mocks `../src/platform/feeds` and `../src/specs/NativeNightAudio`, and has `freshAudio()`):

```tsx
import { loadNights } from "../vendor/player/src/lib/rest/ledger";

test("a finished night is recorded to the rest ledger", async () => {
  mockAudio = freshAudio();
  mockPoolResult = { pool: [{ id: "a", title: "A Quiet Night", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" }], feedTitles: { f: "F" }, errors: [] };
  const before = loadNights().length;
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {});
  await act(async () => { tree.root.findByProps({ testID: "timer-5" }).props.onPress(); });
  await act(async () => { tree.root.findByProps({ testID: "start-shuffle" }).props.onPress(); });
  await act(async () => { mockAudio.fireEnded({ episodeId: "a", heardSeconds: 300 }); });
  const nights = loadNights();
  expect(nights.length).toBe(before + 1);
  expect(nights[nights.length - 1].endedVia).toBe("faded");
  expect(nights[nights.length - 1].timerMinutes).toBe(5);
  act(() => { tree.unmount(); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest __tests__/App.night.test.tsx -t "rest ledger"`
Expected: FAIL — no night appended (`length` unchanged).

- [ ] **Step 3: Wire `App.tsx`**

Add imports:
```tsx
import { AppState } from "react-native";
import { RestSession } from "./vendor/player/src/lib/rest/session";
import { appendNight } from "./vendor/player/src/lib/rest/ledger";
```
Add refs beside the others:
```tsx
const restRef = useRef<RestSession | null>(null);
const appStateRef = useRef(AppState.currentState);
```
Add an AppState effect (near the mount/subscription effects):
```tsx
useEffect(() => {
  const sub = AppState.addEventListener("change", (s) => { appStateRef.current = s; });
  return () => sub.remove();
}, []);
```
In `beginPlayback`, after `startedAtRef.current = Date.now();` (and `nowRef.current = lead;`), construct the session:
```tsx
restRef.current = new RestSession(startedAtRef.current, minutes);
```
In the 1s interval body, after computing `const left = (end - Date.now()) / 1000;` and before/after the UI updates, feed the tick (guard so it only runs while a night is live):
```tsx
restRef.current?.tick({
  now: Date.now(),
  hidden: appStateRef.current !== "active",
  fadingOrDone: left <= FADE_SECONDS,
});
```
In `finishNight(ep, heardSec, endedVia)`, after `saveLastNight(...)` (inside the `if (ep)` block is fine, but the session should be finished whenever a night ends — put it right before the state resets, unconditionally):
```tsx
if (restRef.current) {
  appendNight(restRef.current.finish(endedVia, Date.now()));
  restRef.current = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest __tests__/App.night.test.tsx -t "rest ledger"`
Expected: PASS.

- [ ] **Step 5: Kill-recovery appends a minimal night**

In `src/logic/nightmarker.ts`, extend `reconcileToLastNight` to also record a rest night (add the import `import { appendNight } from "../../vendor/player/src/lib/rest/ledger";`), appending before `clearMarker()`:
```ts
appendNight({
  startedAt: m.startedAt,
  timerMinutes: m.timerMinutes,
  endedVia: "faded",
  sleptAtMs: null,
  timeToSleepMs: null,
  interactions: 0,
  detector: "none",
});
```
Add to `src/logic/nightmarker.test.ts`:
```ts
import { loadNights } from "../../vendor/player/src/lib/rest/ledger";

test("reconcile records a detector:none rest night", () => {
  const m = { episodeId: "a", startedAt: 5000, timerMinutes: 5, lineup: [ep("a")], playedIds: [], feedTitles: {}, wasVaried: false };
  const before = loadNights().length;
  saveMarker(m);
  reconcileToLastNight(m, 5000 + 5 * 60_000);
  const nights = loadNights();
  expect(nights.length).toBe(before + 1);
  expect(nights[nights.length - 1].detector).toBe("none");
});
```

- [ ] **Step 6: Run full suite + typecheck, commit**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest && PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit`
```bash
git add App.tsx src/logic/nightmarker.ts __tests__/App.night.test.tsx src/logic/nightmarker.test.ts
git commit -m "feat: observe each night with the rest detector and record to the ledger"
```

---

### Task 2: Interaction capture on `PlayerScreen`

Any touch on the player registers as wakefulness via `noteInteraction`, observed without consuming the touch.

**Files:**
- Modify: `src/screens/PlayerScreen.tsx`
- Modify: `App.tsx` (pass `onInteract`)
- Modify: `src/screens/PlayerScreen.test.tsx`

**Interfaces:**
- `PlayerScreen` gains `onInteract?: () => void`, fired on any touch on its root.
- `App` passes `onInteract={() => restRef.current?.noteInteraction()}`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/PlayerScreen.test.tsx — add
test("a touch on the player fires onInteract without swallowing it", () => {
  const onInteract = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<PlayerScreen title="A" remaining={90} volume={0.5} onStop={() => {}} onInteract={onInteract} />); });
  // the root View exposes the responder-capture hook
  const root = tree.root.findByProps({ testID: "player-root" });
  const captured = root.props.onStartShouldSetResponderCapture();
  expect(onInteract).toHaveBeenCalled();
  expect(captured).toBe(false); // does not consume the touch
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/PlayerScreen.test.tsx -t "onInteract"`
Expected: FAIL — no `player-root` / `onInteract`.

- [ ] **Step 3: Implement**

In `src/screens/PlayerScreen.tsx`, add `onInteract` to the props interface and wrap the root `View`:
```tsx
interface PlayerProps { title: string; remaining: number; volume: number; onStop: () => void; onInteract?: () => void; }

export default function PlayerScreen({ title, remaining, volume, onStop, onInteract }: PlayerProps) {
  return (
    <View
      style={s.body}
      testID="player-root"
      onStartShouldSetResponderCapture={() => { onInteract?.(); return false; }}
    >
      {/* …existing moon/title/countdown/volume/stop… */}
    </View>
  );
}
```
(Keep all existing children and styles; only the root `View` gains `testID` + the capture hook.)

In `App.tsx`, pass the handler where `PlayerScreen` is rendered:
```tsx
<PlayerScreen title={now.title} remaining={remaining} volume={volume}
  onStop={() => endSession()} onInteract={() => restRef.current?.noteInteraction()} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/PlayerScreen.test.tsx`
Expected: PASS (existing PlayerScreen tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/screens/PlayerScreen.tsx src/screens/PlayerScreen.test.tsx App.tsx
git commit -m "feat: count player touches as wakefulness for the detector"
```

---

### Task 3: `RestScreen` — history, stats, and self-label calibration

Native port of the web `RestView`: rollup stats, last night's episodes with a drift marker, and the "did you fall asleep?" self-label that calibrates.

**Files:**
- Create: `src/screens/RestScreen.tsx`
- Test: `src/screens/RestScreen.test.tsx`

**Interfaces:**
- Consumes: `loadNights`, `rollup`, `setSelfLabel`, `loadParams`, `saveParams` (`rest/ledger`); `tightenAfterFalsePositive` (`rest/calibrate`); `fmtDuration`, `lastNight` (`rest/surface`); `getPlays` (`store`); `playsSince`, `playAtMoment` (`plays`).
- Produces:
  ```ts
  export default function RestScreen({ onClose }: { onClose: () => void }): JSX.Element
  ```
- `testID`s: `rest-nights`, `rest-best`, `rest-median`, `rest-label-yes`, `rest-label-no`, `rest-back`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/RestScreen.test.tsx
import "../platform/storage";
import { installLocalStorage } from "../platform/storage";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import RestScreen from "./RestScreen";
import { appendNight, loadNights, loadParams, saveParams } from "../../vendor/player/src/lib/rest/ledger";
import { DEFAULT_PARAMS } from "../../vendor/player/src/lib/rest/detector";

installLocalStorage();

function seedSleptNight() {
  saveParams(DEFAULT_PARAMS); // so tightenAfterFalsePositive has params to tighten
  appendNight({
    startedAt: 1000, timerMinutes: 45, endedVia: "faded",
    sleptAtMs: 8 * 60_000, timeToSleepMs: 8 * 60_000, interactions: 2, detector: "inference",
  });
}

test("shows the drifted-off count from the ledger", () => {
  localStorage.clear();
  seedSleptNight();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<RestScreen onClose={() => {}} />); });
  expect(tree.root.findByProps({ testID: "rest-nights" }).props.children).toBe(1);
});

test("answering 'no' to a scored night tightens the detector", () => {
  localStorage.clear();
  seedSleptNight();
  const alpha0 = loadParams()!.alpha;
  const onClose = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<RestScreen onClose={onClose} />); });
  act(() => { tree.root.findByProps({ testID: "rest-label-no" }).props.onPress(); });
  const night = loadNights()[0];
  expect(night.selfLabel).toBe("awake");
  expect(loadParams()!.alpha).not.toBe(alpha0); // tightened
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/RestScreen.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/screens/RestScreen.tsx
import React, { useMemo } from "react";
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { loadNights, rollup, setSelfLabel, loadParams, saveParams } from "../../vendor/player/src/lib/rest/ledger";
import { tightenAfterFalsePositive } from "../../vendor/player/src/lib/rest/calibrate";
import { fmtDuration, lastNight } from "../../vendor/player/src/lib/rest/surface";
import { getPlays } from "../../vendor/player/src/lib/store";
import { playsSince, playAtMoment } from "../../vendor/player/src/lib/plays";

export default function RestScreen({ onClose }: { onClose: () => void }) {
  const nights = useMemo(() => loadNights(), []);
  const r = useMemo(() => rollup(nights), [nights]);
  const last = lastNight();
  const lastPlays = useMemo(() => (last ? playsSince(getPlays(), last.startedAt) : []), [last?.startedAt]);
  const driftedDuring = useMemo(
    () => (last && last.sleptAtMs !== null ? playAtMoment(lastPlays, last.startedAt + last.sleptAtMs) : null),
    [lastPlays, last?.startedAt, last?.sleptAtMs],
  );

  function label(kind: "slept" | "awake") {
    if (!last) return;
    setSelfLabel(last.startedAt, kind);
    if (kind === "awake" && last.sleptAtMs !== null) {
      const p = loadParams();
      if (p) saveParams(tightenAfterFalsePositive(p));
    }
    onClose();
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.body}>
      <View style={s.stat}>
        <Text style={s.big} testID="rest-nights">{r.nightsSlept}</Text>
        <Text style={s.cap}>nights you drifted off</Text>
      </View>
      {r.bestTimeToSleepMs !== null && (
        <View style={s.stat}>
          <Text style={s.mid} testID="rest-best">{fmtDuration(r.bestTimeToSleepMs)}</Text>
          <Text style={s.cap}>fastest you left us</Text>
        </View>
      )}
      {r.medianTimeToSleepMs !== null && (
        <View style={s.stat}>
          <Text style={s.mid} testID="rest-median">{fmtDuration(r.medianTimeToSleepMs)}</Text>
          <Text style={s.cap}>how long you usually take</Text>
        </View>
      )}
      {lastPlays.length > 0 && (
        <View style={s.section}>
          <Text style={s.cap}>last night</Text>
          {lastPlays.map((p) => (
            <View key={p.id} style={s.playRow}>
              <Text style={s.playTitle} numberOfLines={1}>{p.title || "an episode"}</Text>
              <Text style={s.playMin}>{Math.max(1, Math.round(p.heardSec / 60))} min</Text>
              {driftedDuring?.id === p.id && <Text style={s.drift}>you drifted off here</Text>}
            </View>
          ))}
        </View>
      )}
      {last && last.sleptAtMs !== null && last.selfLabel === undefined && (
        <View style={s.section}>
          <Text style={s.prompt}>did you fall asleep to it last time?</Text>
          <View style={s.row}>
            <TouchableOpacity testID="rest-label-yes" style={s.btn} onPress={() => label("slept")}><Text style={s.btnT}>yes</Text></TouchableOpacity>
            <TouchableOpacity testID="rest-label-no" style={s.btn} onPress={() => label("awake")}><Text style={s.btnT}>no</Text></TouchableOpacity>
          </View>
        </View>
      )}
      <Text style={s.note}>counted only on this device. nothing sent anywhere.</Text>
      <TouchableOpacity testID="rest-back" onPress={onClose}><Text style={s.back}>back</Text></TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050508" },
  body: { padding: 24, gap: 28, alignItems: "center" },
  stat: { alignItems: "center", gap: 4 },
  big: { color: "#c8c0b0", fontSize: 48 },
  mid: { color: "#b0a898", fontSize: 22 },
  cap: { color: "#8a7a5c", fontSize: 11, textTransform: "uppercase", letterSpacing: 2 },
  section: { alignSelf: "stretch", borderTopWidth: 1, borderTopColor: "#241f30", paddingTop: 24, gap: 10, alignItems: "center" },
  playRow: { alignSelf: "stretch", gap: 2 },
  playTitle: { color: "#b0a898", fontSize: 14 },
  playMin: { color: "#6b6255", fontSize: 11 },
  drift: { color: "#6e5d44", fontSize: 11 },
  prompt: { color: "#8a7a5c", fontSize: 14 },
  row: { flexDirection: "row", gap: 12 },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
  btnT: { color: "#d9c9a8", fontSize: 14 },
  note: { color: "#4a4540", fontSize: 11, textAlign: "center" },
  back: { color: "#8a7a5c", fontSize: 12, textDecorationLine: "underline" },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/RestScreen.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/screens/RestScreen.tsx src/screens/RestScreen.test.tsx
git commit -m "feat: RestScreen — sleep history, stats, and self-label calibration"
```

---

### Task 4: Navigate to `RestScreen` from setup

A "nights" link on `SetupScreen` opens `RestScreen`; `App` routes between them.

**Files:**
- Modify: `src/screens/SetupScreen.tsx` (add `onOpenRest` + link)
- Modify: `App.tsx` (a `view` state: setup ↔ rest)
- Modify: `src/screens/SetupScreen.test.tsx`
- Modify: `__tests__/App.night.test.tsx`

**Interfaces:**
- `SetupScreen` gains `onOpenRest?: () => void` and a `testID="open-rest"` link.
- `App` holds `const [showRest, setShowRest] = useState(false)`; renders `RestScreen` when `showRest` and not playing.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/screens/SetupScreen.test.tsx — add
test("the nights link fires onOpenRest", () => {
  const onOpenRest = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} onOpenRest={onOpenRest} />); });
  act(() => { tree.root.findByProps({ testID: "open-rest" }).props.onPress(); });
  expect(onOpenRest).toHaveBeenCalled();
});
```
```tsx
// __tests__/App.night.test.tsx — add
test("opening nights shows the rest screen and back returns to setup", async () => {
  mockAudio = freshAudio();
  mockPoolResult = { pool: [{ id: "a", title: "A", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" }], feedTitles: { f: "F" }, errors: [] };
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {});
  await act(async () => { tree.root.findByProps({ testID: "open-rest" }).props.onPress(); });
  expect(tree.root.findAllByProps({ testID: "rest-nights" }).length).toBe(1);
  await act(async () => { tree.root.findByProps({ testID: "rest-back" }).props.onPress(); });
  expect(tree.root.findAllByProps({ testID: "open-rest" }).length).toBe(1);
  act(() => { tree.unmount(); });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/SetupScreen.test.tsx __tests__/App.night.test.tsx -t "nights"`
Expected: FAIL — no `open-rest` / rest routing.

- [ ] **Step 3: Implement**

In `src/screens/SetupScreen.tsx`, add to the props interface `onOpenRest?: () => void;` and a link at the end of the `ScrollView` (after the start section):
```tsx
{props.onOpenRest && (
  <TouchableOpacity testID="open-rest" onPress={props.onOpenRest} style={s.nightsLink}>
    <Text style={s.nightsText}>nights ›</Text>
  </TouchableOpacity>
)}
```
Add styles `nightsLink: { marginTop: 12 }, nightsText: { color: "#6e5d44", fontSize: 13 }`.

In `App.tsx`, add `import RestScreen from "./src/screens/RestScreen";`, state `const [showRest, setShowRest] = useState(false);`, and route in the render (add a branch before the `SetupScreen` branch, still inside the `!playing` case):
```tsx
) : showRest ? (
  <RestScreen onClose={() => setShowRest(false)} />
) : (
  <SetupScreen onStart={onStart} onResume={onResume}
    resumeAvailable={!!resumeNight(loadTimerMinutes())}
    onOpenRest={() => setShowRest(true)} />
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/SetupScreen.test.tsx __tests__/App.night.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck, commit**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest && PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit`
```bash
git add src/screens/SetupScreen.tsx App.tsx src/screens/SetupScreen.test.tsx __tests__/App.night.test.tsx
git commit -m "feat: reach the sleep history from setup"
```

---

### Task 5: On-device smoke (Pixel 7)

Light confirmation the observational loop works foreground. No locked-screen dependency (detector is foreground-only by design).

**Files:** none (manual/device).

- [ ] **Step 1: Build + install HEAD**

```bash
cd /Users/windowlicker/sleepcast-app
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=/opt/homebrew/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
pkill -f "react-native start"; nohup npx react-native start > /tmp/metro-s3.log 2>&1 &
npx react-native run-android
```

- [ ] **Step 2: Exercise the loop, screenshot each**

1. Open `nights ›` from setup → `RestScreen` renders (may be empty first run).
2. Start a 5-minute night, leave the app foreground and the screen on, don't touch it; let the timer fade and stop.
3. Open `nights ›` → confirm the night appears with a time-to-sleep, and the "did you fall asleep?" prompt shows. Tap **no** → returns to setup; reopen and confirm the prompt is gone (labeled) — the detector was tightened.
4. Start another night and **tap the screen a few times** during it; after it ends, that night should show more interactions (no onset if you kept interacting through the fade).

---

## Self-Review

**Spec coverage:** detector wired into the night (Task 1) ✓; interaction capture (Task 2) ✓; RestScreen history/stats/last-night episodes (Task 3) ✓; self-label calibration + `tightenAfterFalsePositive` (Task 3) ✓; navigation from setup (Task 4) ✓; reconcile appends a `"none"` night (Task 1) ✓; observational-only, no playback change (the tick never ends a night — the detector's return is only used by `finish`) ✓; no `vendor/player` edits ✓; foreground-only degradation is inherent (interval doesn't tick when backgrounded) ✓.

**Placeholder scan:** none — every step has concrete code and commands.

**Type/name consistency:** `RestSession(startedAt, timerMinutes)`, `.noteInteraction()`, `.tick({now, hidden, fadingOrDone})`, `.finish(endedVia, now)`, `appendNight`, `loadNights`, `rollup`, `setSelfLabel`, `loadParams`/`saveParams`, `tightenAfterFalsePositive`, `fmtDuration`, `lastNight`, `playsSince`, `playAtMoment` are used with the signatures read from the lib. `PlayerScreen` `onInteract`, `SetupScreen` `onOpenRest`, `RestScreen` `onClose`, and the `open-rest`/`rest-*` testIDs are consistent across tasks.
