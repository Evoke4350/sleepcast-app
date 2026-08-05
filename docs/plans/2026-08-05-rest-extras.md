# Rest Extras (Quarter-Hour Rule + Step-Back) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the opt-in quarter-hour rule (stop + suggest getting up after ~25 restless minutes) and step-back (offer to go quiet for a month after a good run), reusing the `rest/` engine unchanged.

**Architecture:** Both are pure-TS over the vendor `rest/quarterhour`, `rest/stepback`, and `rest/ledger` modules plus slice 3's `RestSession.wakefulness()`. Quarter-hour is checked in `App.tsx`'s existing 1s foreground interval and shows a getting-up screen; step-back is an eligibility offer on `SetupScreen`; a 30-day "quiet" state (in the ledger) suppresses the resume prompt and the quarter-hour rule.

**Tech Stack:** React Native 0.86, TypeScript, the `vendor/player` `rest/` lib, Jest + react-test-renderer.

## Global Constraints

- Never edit `vendor/player/`. Consume `shouldSuggestGettingUp`, `qualifiesForStepBack`, `isQuiet`, `quietUntilFrom`, `loadQuietUntil`/`saveQuietUntil`/`loadStepBackAsked`/`markStepBackAsked`, and `Settings.quarterHourRule` as-is.
- The quarter-hour rule fires **at most once per night** and only while foregrounded (the interval doesn't run backgrounded). It ends the night via the existing `endSession()` (which cancels the native timer and records the night).
- "Quiet" (`isQuiet(loadQuietUntil(), now)`) suppresses both the resume-last-night affordance and the quarter-hour check for its duration.
- Run tests: `PATH=/opt/homebrew/bin:$PATH npx jest <path>`; typecheck `npx tsc --noEmit`. Both stay clean. TDD. No native change.

---

### Task 1: Quarter-hour rule

Opt-in toggle + in-night check that stops and shows a getting-up screen.

**Files:**
- Create: `src/screens/GettingUpScreen.tsx`
- Test: `src/screens/GettingUpScreen.test.tsx`
- Modify: `App.tsx`, `src/screens/SetupScreen.tsx`
- Modify: `__tests__/App.night.test.tsx`, `src/screens/SetupScreen.test.tsx`

**Interfaces:**
- `GettingUpScreen({ onDismiss }: { onDismiss: () => void })` — a full-screen message; `testID`s `gettingup`, `gettingup-dismiss`.
- Consumes `shouldSuggestGettingUp` (`vendor/player/src/lib/rest/quarterhour`); `RestSession.wakefulness(now)` (slice 3).

- [ ] **Step 1: Write the failing GettingUpScreen test**

```tsx
// src/screens/GettingUpScreen.test.tsx
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import GettingUpScreen from "./GettingUpScreen";

test("renders the suggestion and fires onDismiss", () => {
  const onDismiss = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<GettingUpScreen onDismiss={onDismiss} />); });
  expect(tree.root.findByProps({ testID: "gettingup" })).toBeTruthy();
  act(() => { tree.root.findByProps({ testID: "gettingup-dismiss" }).props.onPress(); });
  expect(onDismiss).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/GettingUpScreen.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement GettingUpScreen**

```tsx
// src/screens/GettingUpScreen.tsx
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

export default function GettingUpScreen({ onDismiss }: { onDismiss: () => void }) {
  return (
    <View style={s.body} testID="gettingup">
      <Text style={s.title}>you've been up a while</Text>
      <Text style={s.body2}>
        the bed works best when it's just for sleep. try getting up for a few
        minutes — a glass of water, a dim room — and come back when you're heavy.
      </Text>
      <TouchableOpacity style={s.btn} testID="gettingup-dismiss" onPress={onDismiss}>
        <Text style={s.btnT}>ok</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 20, padding: 32 },
  title: { color: "#c8c0b0", fontSize: 20 },
  body2: { color: "#8a7a5c", fontSize: 14, textAlign: "center", lineHeight: 21 },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 24, paddingVertical: 10, marginTop: 8 },
  btnT: { color: "#d9c9a8", fontSize: 15 },
});
```

- [ ] **Step 4: Add the SetupScreen quarter-hour toggle (failing test first)**

```tsx
// src/screens/SetupScreen.test.tsx — add
test("the quarter-hour toggle persists the setting", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  act(() => { find(tree, "quarterhour-toggle").props.onValueChange(true); });
  expect(loadState().settings.quarterHourRule).toBe(true);
});
```
Then implement in `src/screens/SetupScreen.tsx` — add a section after the timer (before start):
```tsx
<Text style={s.h}>get-up nudge</Text>
<View style={s.qhRow}>
  <Text style={s.qhLabel}>stop & suggest getting up after 25 restless minutes</Text>
  <Switch
    testID="quarterhour-toggle"
    value={state.settings.quarterHourRule}
    onValueChange={(v) => persist({ ...state, settings: { ...state.settings, quarterHourRule: v } })}
  />
</View>
```
Styles: `qhRow: { flexDirection: "row", alignItems: "center", gap: 10 }, qhLabel: { color: "#c8c0b0", flex: 1, fontSize: 13 }`. (`persist` and `find` are existing helpers.)

- [ ] **Step 5: Wire the in-night check in `App.tsx` (failing test first)**

```tsx
// __tests__/App.night.test.tsx — add. freshAudio()/mocks already exist.
import { loadState, saveState } from "../vendor/player/src/lib/store";

test("the quarter-hour rule stops the night and shows the getting-up screen", async () => {
  mockAudio = freshAudio();
  mockPoolResult = { pool: [{ id: "a", title: "A", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" }], feedTitles: { f: "F" }, errors: [] };
  const s = loadState();
  saveState({ ...s, settings: { ...s.settings, quarterHourRule: true } });
  let tree!: TestRenderer.ReactTestRenderer;
  jest.useFakeTimers();
  try {
    await act(async () => { tree = TestRenderer.create(<App />); });
    await act(async () => {});
    await act(async () => { tree.root.findByProps({ testID: "timer-45" }).props.onPress(); });
    await act(async () => { tree.root.findByProps({ testID: "start-shuffle" }).props.onPress(); });
    // simulate 3 restless touches, then advance past the 25-min threshold with a recent touch
    const root = tree.root.findByProps({ testID: "player-root" });
    await act(async () => { root.props.onStartShouldSetResponderCapture(); root.props.onStartShouldSetResponderCapture(); root.props.onStartShouldSetResponderCapture(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(26 * 60_000); });
    // a fresh touch inside the recent window, then one more interval tick
    await act(async () => { tree.root.findByProps({ testID: "player-root" }).props.onStartShouldSetResponderCapture(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
    expect(tree.root.findAllByProps({ testID: "gettingup" }).length).toBe(1);
    expect(mockAudio.cancelTimer).toHaveBeenCalled();
    act(() => { tree.unmount(); });
  } finally { jest.useRealTimers(); }
});
```
(If the fake-timer interplay with the interval + wakefulness proves fiddly, an acceptable alternative is to unit-test a small extracted `shouldNudge(now, quarterHourOn, spent, session)` helper directly against `shouldSuggestGettingUp`, plus a render test that `setGettingUp(true)` shows the screen — keep the assertion real either way.)

Then wire `App.tsx`:
- Import `import { shouldSuggestGettingUp } from "./vendor/player/src/lib/rest/quarterhour";`.
- Add refs/state: `const quarterHourRef = useRef(false); const ruleSpentRef = useRef(false); const [gettingUp, setGettingUp] = useState(false);`.
- In `beginPlayback`, before scheduling: `quarterHourRef.current = loadState().settings.quarterHourRule; ruleSpentRef.current = false;`.
- In the 1s interval, after the rest `tick`, add:
  ```tsx
  if (quarterHourRef.current && !ruleSpentRef.current && restRef.current) {
    const now = Date.now();
    const w = restRef.current.wakefulness(now);
    if (shouldSuggestGettingUp({ elapsedMs: now - startedAtRef.current, ...w })) {
      ruleSpentRef.current = true;
      setGettingUp(true);
      endSession();
    }
  }
  ```
- Render: add a branch (before the `playing` branch, since `endSession` sets `playing` false but `gettingUp` should show): in the `!error && pool !== null` region, `gettingUp ? <GettingUpScreen onDismiss={() => setGettingUp(false)} /> : …`. Import `GettingUpScreen`.

- [ ] **Step 6: Run tests, full suite + typecheck, commit**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest && PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit`
```bash
git add App.tsx src/screens/GettingUpScreen.tsx src/screens/GettingUpScreen.test.tsx src/screens/SetupScreen.tsx __tests__/App.night.test.tsx src/screens/SetupScreen.test.tsx
git commit -m "feat: opt-in quarter-hour rule — stop and suggest getting up"
```

---

### Task 2: Step-back offer + quiet gating

An eligibility offer on setup; accepting goes quiet for 30 days, suppressing the resume prompt and quarter-hour rule.

**Files:**
- Modify: `src/screens/SetupScreen.tsx`, `App.tsx`
- Modify: `src/screens/SetupScreen.test.tsx`, `__tests__/App.night.test.tsx`

**Interfaces:**
- Consumes `qualifiesForStepBack`, `isQuiet`, `quietUntilFrom` (`vendor/player/src/lib/rest/stepback`); `loadNights`, `loadQuietUntil`, `saveQuietUntil`, `loadStepBackAsked`, `markStepBackAsked` (`vendor/player/src/lib/rest/ledger`).

- [ ] **Step 1: Write the failing SetupScreen tests**

```tsx
// src/screens/SetupScreen.test.tsx — add
import { appendNight } from "../../vendor/player/src/lib/rest/ledger";
import { loadQuietUntil, loadStepBackAsked } from "../../vendor/player/src/lib/rest/ledger";

function seedGoodRun() {
  // 12 nights all slept fast (well under 20 min), no self-label "awake"
  for (let i = 0; i < 12; i++) {
    appendNight({ startedAt: 1000 + i, timerMinutes: 45, endedVia: "faded",
      sleptAtMs: 8 * 60_000, timeToSleepMs: 8 * 60_000, interactions: 1, detector: "inference" });
  }
}

test("step-back offer appears only after a qualifying run", () => {
  localStorage.clear();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  expect(tree.root.findAllByProps({ testID: "stepback-offer" }).length).toBe(0); // no history
  seedGoodRun();
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  expect(tree.root.findAllByProps({ testID: "stepback-offer" }).length).toBe(1);
});

test("accepting step-back goes quiet and records the ask", () => {
  localStorage.clear();
  seedGoodRun();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  act(() => { tree.root.findByProps({ testID: "stepback-accept" }).props.onPress(); });
  expect(loadQuietUntil()).not.toBeNull();
  expect(loadStepBackAsked()).not.toBeNull();
  expect(tree.root.findAllByProps({ testID: "stepback-offer" }).length).toBe(0); // hidden after
});

test("declining step-back records the ask but stays loud", () => {
  localStorage.clear();
  seedGoodRun();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  act(() => { tree.root.findByProps({ testID: "stepback-decline" }).props.onPress(); });
  expect(loadQuietUntil()).toBeNull();
  expect(loadStepBackAsked()).not.toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/screens/SetupScreen.test.tsx -t "step-back"`
Expected: FAIL — no `stepback-offer`.

- [ ] **Step 3: Implement the offer in `SetupScreen.tsx`**

Imports:
```tsx
import { qualifiesForStepBack, isQuiet, quietUntilFrom } from "../../vendor/player/src/lib/rest/stepback";
import { loadNights, loadQuietUntil, saveQuietUntil, loadStepBackAsked, markStepBackAsked } from "../../vendor/player/src/lib/rest/ledger";
```
State + eligibility (compute once on mount):
```tsx
const [showStepBack, setShowStepBack] = useState(() => {
  const now = Date.now();
  if (isQuiet(loadQuietUntil(), now)) return false;
  const asked = loadStepBackAsked();
  if (asked !== null && isQuiet(quietUntilFrom(asked), now)) return false;
  return qualifiesForStepBack(loadNights());
});
function acceptStepBack() { const now = Date.now(); saveQuietUntil(quietUntilFrom(now)); markStepBackAsked(now); setShowStepBack(false); }
function declineStepBack() { markStepBackAsked(Date.now()); setShowStepBack(false); }
```
Card at the top of the `ScrollView` (above FEEDS):
```tsx
{showStepBack && (
  <View testID="stepback-offer" style={s.stepback}>
    <Text style={s.sbTitle}>you've been falling asleep quickly for a while.</Text>
    <Text style={s.sbBody}>you might not need us right now — we can stop nudging and stay out of the way for a month.</Text>
    <View style={s.row}>
      <TouchableOpacity testID="stepback-accept" style={s.btn} onPress={acceptStepBack}><Text style={s.btnT}>go quiet</Text></TouchableOpacity>
      <TouchableOpacity testID="stepback-decline" style={s.btn} onPress={declineStepBack}><Text style={s.btnT}>not now</Text></TouchableOpacity>
    </View>
  </View>
)}
```
Styles: `stepback: { alignSelf: "stretch", borderWidth: 1, borderColor: "#3a3325", borderRadius: 12, backgroundColor: "#171310", padding: 16, gap: 8 }, sbTitle: { color: "#d9c9a8", fontSize: 14 }, sbBody: { color: "#8a7a5c", fontSize: 12 }`.

- [ ] **Step 4: Gate resume on quiet in `App.tsx` (failing test first)**

```tsx
// __tests__/App.night.test.tsx — add
import { saveLastNight } from "../vendor/player/src/lib/store";
import { saveQuietUntil } from "../vendor/player/src/lib/rest/ledger";
import { quietUntilFrom } from "../vendor/player/src/lib/rest/stepback";

test("quiet suppresses the resume affordance", async () => {
  mockAudio = freshAudio();
  mockPoolResult = { pool: [{ id: "a", title: "A", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" }], feedTitles: { f: "F" }, errors: [] };
  // a resumable night exists...
  saveLastNight({ pool: [{ id: "a", title: "A", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" } as any, { id: "b", title: "B", url: "https://x/b.mp3", feedId: "f", date: "2024-01-01" } as any], playedIds: ["a"], feedTitles: {}, artworkByFeedId: {}, skipIntroByFeedId: {}, endedVia: "faded", endedAt: Date.now(), wasVaried: false });
  saveQuietUntil(quietUntilFrom(Date.now())); // ...but we're quiet
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {});
  expect(tree.root.findAllByProps({ testID: "start-resume" }).length).toBe(0);
  act(() => { tree.unmount(); });
});
```

- [ ] **Step 5: Gate resume + quarter-hour on quiet in `App.tsx`**

Import `import { isQuiet } from "./vendor/player/src/lib/rest/stepback"; import { loadQuietUntil } from "./vendor/player/src/lib/rest/ledger";`. Change the `resumeAvailable` prop:
```tsx
resumeAvailable={!!resumeNight(loadTimerMinutes()) && !isQuiet(loadQuietUntil(), Date.now())}
```
And gate the Task-1 quarter-hour check by adding `&& !isQuiet(loadQuietUntil(), Date.now())` to its condition (or set `quarterHourRef.current = settings.quarterHourRule && !isQuiet(...)` in `beginPlayback`).

- [ ] **Step 6: Full suite + typecheck, commit**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest && PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit`
```bash
git add src/screens/SetupScreen.tsx App.tsx src/screens/SetupScreen.test.tsx __tests__/App.night.test.tsx
git commit -m "feat: step-back offer and a 30-day quiet that suppresses nudges"
```

---

### Task 3: On-device smoke (Pixel 7)

- [ ] **Step 1: Build + install HEAD** (`npx react-native run-android` with the slice env).
- [ ] **Step 2: Verify**
  1. Open setup → toggle the **get-up nudge** on; confirm it persists across a relaunch (`loadState().settings.quarterHourRule`).
  2. Confirm the **step-back** card does NOT appear (no qualifying history yet).
  3. (Optional, fast) With the toggle on, start a night and tap the screen several times; the 25-minute threshold makes a full fire slow to reproduce by hand — the fire path is unit-tested, so here just confirm the toggle state and that a normal night still plays and stops.
  4. Screenshot the toggle and (if reproduced) the getting-up screen.

---

## Self-Review

**Spec coverage:** quarter-hour toggle persisting `quarterHourRule` (Task 1) ✓; in-night check via `shouldSuggestGettingUp` + `wakefulness`, fires once, stops the night (Task 1) ✓; getting-up screen (Task 1) ✓; step-back eligibility offer with accept/decline writing quiet/asked (Task 2) ✓; quiet suppresses resume + quarter-hour (Task 2) ✓; engine reused unchanged, no native change (Global Constraints) ✓; goodbye/drift out of scope ✓.

**Placeholder scan:** none — concrete code and commands; the one alternative (extract `shouldNudge` if fake-timer wiring is fiddly, Task 1 Step 5) is a stated fallback with a real assertion either way, not a TODO.

**Type/name consistency:** `shouldSuggestGettingUp({elapsedMs, interactions, msSinceLastInteraction})` fed from `RestSession.wakefulness(now)`; `qualifiesForStepBack`/`isQuiet`/`quietUntilFrom`; `loadQuietUntil`/`saveQuietUntil`/`loadStepBackAsked`/`markStepBackAsked`; `GettingUpScreen({onDismiss})`; testIDs `gettingup`, `gettingup-dismiss`, `quarterhour-toggle`, `stepback-offer`, `stepback-accept`, `stepback-decline` — consistent across tasks.
