import "../src/platform/storage";
import { installLocalStorage } from "../src/platform/storage";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
// Real store module (not mocked) so the regression test below can assert on
// what App actually persisted.
import { loadLastNight, loadState, saveState } from "../vendor/player/src/lib/store";
// Real nightmarker module (not mocked) so the reconcile-on-launch test below
// can seed a marker exactly as beginPlayback would, and assert it gets
// cleared exactly as reconcileToLastNight would.
import { saveMarker, loadMarker } from "../src/logic/nightmarker";
// Real rest ledger module (not mocked) so the rest-detector wiring test below
// can assert App actually appended a RestSession finish() to the ledger.
import { loadNights } from "../vendor/player/src/lib/rest/ledger";
import GettingUpScreen from "../src/screens/GettingUpScreen";

installLocalStorage();

// A mutable stub the tests drive. `getNightAudio()` returns whatever
// `mockAudio` currently points at, so each test can install its own fresh
// stub (or null, matching Jest's "no native module" reality) before render.
let mockAudio: any = null;
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
    // Defaults to "still playing" so tests above that start a night without
    // ever ending it (and so leave a real live-night marker behind in the
    // shared MMKV-backed storage) don't get that marker swept up by a later
    // test's mount-time reconcile check. Only the reconcile test below
    // overrides this to false.
    isPlaying: jest.fn(async () => true),
  };
}
// Deterministic pool so we don't hit the network in a unit test. A mutable
// module-scope result (babel-plugin-jest-hoist allows out-of-scope idents
// that start with "mock") lets the error-path test below flip buildPool to
// fail without a second jest.mock module.
let mockPoolResult: { pool: any[]; feedTitles: Record<string, string>; errors: string[] } = {
  pool: [{ id: "a", title: "A Quiet Night", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" }],
  feedTitles: { f: "F" }, errors: [],
};
jest.mock("../src/platform/feeds", () => ({
  buildPool: async () => mockPoolResult,
}));

import App from "../App";

// Several tests below start a night (via beginPlayback) without ever ending
// it, which writes a real live-night marker into the shared MMKV-backed
// storage — App.tsx and this test file both import the real (unmocked)
// storage/nightmarker modules. Without a reset, that marker would still be
// on disk when the NEXT test mounts a fresh <App/>, and its mount-time
// reconcile effect would pick up a marker that has nothing to do with that
// test. Clearing storage before every test, and resetting mockAudio to "no
// native module" (undefined, matching Jest's real TurboModuleRegistry
// behavior), keeps each test's marker/ledger state fully self-contained.
beforeEach(() => {
  localStorage.clear();
  mockAudio = undefined;
});

test("starting shuffle moves from setup to the player screen", async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {}); // let buildPool resolve
  await act(async () => { tree.root.findByProps({ testID: "start-shuffle" }).props.onPress(); });
  expect(tree.root.findByProps({ testID: "nowPlaying" }).props.children).toBe("A Quiet Night");
  // The fade loop's setInterval outlives the test otherwise: unmounting runs
  // the effect cleanup (stopTick), the same path a real screen unmount takes.
  act(() => { tree.unmount(); });
});

test("shows the error screen when the pool can't be built", async () => {
  mockPoolResult = { pool: [], feedTitles: {}, errors: ["boom"] };
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {}); // let buildPool resolve and the .catch run
  expect(tree.root.findByProps({ testID: "error" }).props.children).toBe("boom");
  act(() => { tree.unmount(); });
});

// Slice 2: native now owns the fade/stop timer. JS's setInterval no longer
// writes the ledger on left<=0 (see App.tsx) — it only reflects native's
// countdown/volume in the UI while foregrounded. These tests replace the old
// fake-timer "resume-after-fade" regression test above: instead of driving
// the JS interval to zero, they exercise the real path — scheduling the
// native timer at play time, and reacting to the native onNightEnded event.
test("start schedules the native timer with the episode and fade", async () => {
  mockAudio = freshAudio();
  mockPoolResult = { pool: [{ id: "a", title: "A Quiet Night", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" }], feedTitles: { f: "F" }, errors: [] };
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {});
  await act(async () => { tree.root.findByProps({ testID: "timer-5" }).props.onPress(); });
  await act(async () => { tree.root.findByProps({ testID: "start-shuffle" }).props.onPress(); });
  expect(mockAudio.scheduleFadeAndStop).toHaveBeenCalledWith("a", 300, 60, 1);
  act(() => { tree.unmount(); });
});

// Slice 4, Task 1: the per-feed volume trim from Settings must reach the
// native fade timer, not just the fade curve — native is authoritative for
// volume now, so it needs the trim to fold in.
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

// Regression for the stale-closure bug from slice 1: the bookkeeping used to
// read the `now` STATE from a stale interval closure, so it silently never
// ran on fade-to-zero. Now native fires onNightEnded and App's handler reads
// from refs (nowRef/lineupRef), not the interval, so this proves the ledger
// gets written even though the JS interval never reaches left<=0 itself.
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

// Manual stop goes through the same finishNight() bookkeeping onNightEnded
// uses, just with endedVia "abandoned" instead of "faded" — asserting on the
// saved ledger here (not just cancelTimer) covers that shared path.
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
  const last = loadLastNight();
  expect(last?.endedVia).toBe("abandoned");
  act(() => { tree.unmount(); });
});

// Task 2: if the OS killed the process before onNightEnded could fire, the
// ledger write never happened, but the live-night marker written at play
// time (beginPlayback) survived to disk. On the next launch, App's mount
// effect should notice the marker, confirm with native that nothing is
// actually playing, and reconcile the marker into lastNight/plays so
// resume-after-fade still works.
// Important-fix regression: an onNightEnded that arrives into a JS instance
// with NO live night (e.g. the native timer survived a JS reload while
// nowRef/endAtRef are empty) must NOT clear the reconcile marker — the marker
// is the only remaining record of that night, and finishNight would wipe it
// while writing nothing. The handler should bail early and leave the marker
// for the next-launch reconcile.
test("unmatched onNightEnded leaves the marker intact and writes nothing", async () => {
  mockAudio = freshAudio(); // isPlaying defaults true, so mount-time reconcile leaves the marker alone
  const lead = { id: "a", title: "A Quiet Night", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" };
  mockPoolResult = { pool: [lead], feedTitles: { f: "F" }, errors: [] };
  saveMarker({
    episodeId: "a", startedAt: Date.now() - 5 * 60_000, timerMinutes: 5,
    lineup: [lead], playedIds: [], feedTitles: { f: "F" }, wasVaried: false,
  });
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {}); // buildPool + mount effects settle; no night is ever started
  await act(async () => { mockAudio.fireEnded({ episodeId: "a", heardSeconds: 300 }); });
  expect(loadMarker()).not.toBeNull(); // marker survives for next-launch reconcile
  expect(loadLastNight()).toBeNull(); // the event wrote no ledger entry
  act(() => { tree.unmount(); });
});

// Slice 3, Task 1: App owns a RestSession per night, fed from the 1s tick,
// and finishes it into the rest ledger through the same finishNight funnel
// onNightEnded/manual-stop already share.
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

test("reconciles a killed night's marker on launch when nothing is playing", async () => {
  mockAudio = freshAudio();
  mockAudio.isPlaying = jest.fn(async () => false);
  const lead = { id: "a", title: "A Quiet Night", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" };
  mockPoolResult = { pool: [lead], feedTitles: { f: "F" }, errors: [] };
  saveMarker({
    episodeId: "a", startedAt: Date.now() - 5 * 60_000, timerMinutes: 5,
    lineup: [lead], playedIds: [], feedTitles: { f: "F" }, wasVaried: false,
  });
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {}); // let isPlaying() resolve and the reconcile promise chain run
  const last = loadLastNight();
  expect(last?.playedIds).toContain("a");
  expect(last?.endedVia).toBe("faded");
  expect(loadMarker()).toBeNull();
  act(() => { tree.unmount(); });
});

// Slice 5, Task 1: the opt-in quarter-hour rule — once a night has 3+ touches
// and the most recent one is inside the "just settled" window while total
// elapsed time has crossed the 25-minute threshold, App should stop the
// night (through the same endSession() a manual stop uses) and show the
// getting-up screen, exactly once per night.
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
    // findAllByProps({testID}) double-counts here: RN's View is a forwardRef
    // wrapping a host node of the same name, so a props-only query (unlike
    // findByProps, which forces deep:false) matches both the wrapper and the
    // host. findAllByType against the screen component itself counts actual
    // mounts, which is what "fires once per night" means here.
    expect(tree.root.findAllByType(GettingUpScreen).length).toBe(1);
    expect(tree.root.findByProps({ testID: "gettingup" })).toBeTruthy();
    expect(mockAudio.cancelTimer).toHaveBeenCalled();
    act(() => { tree.unmount(); });
  } finally { jest.useRealTimers(); }
});

test("opening nights shows the rest screen and back returns to setup", async () => {
  mockAudio = freshAudio();
  mockPoolResult = { pool: [{ id: "a", title: "A", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" }], feedTitles: { f: "F" }, errors: [] };
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<App />); });
  await act(async () => {});
  await act(async () => { tree.root.findByProps({ testID: "open-rest" }).props.onPress(); });
  // Verify RestScreen is showing by checking rest-back exists
  expect(() => tree.root.findByProps({ testID: "rest-back" })).not.toThrow();
  await act(async () => { tree.root.findByProps({ testID: "rest-back" }).props.onPress(); });
  // Verify back to SetupScreen by checking open-rest exists
  expect(() => tree.root.findByProps({ testID: "open-rest" })).not.toThrow();
  act(() => { tree.unmount(); });
});
