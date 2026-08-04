import "../src/platform/storage";
import { installLocalStorage } from "../src/platform/storage";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
// Real store module (not mocked) so the regression test below can assert on
// what App actually persisted.
import { loadLastNight } from "../vendor/player/src/lib/store";

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
  expect(mockAudio.scheduleFadeAndStop).toHaveBeenCalledWith("a", 300, 60);
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
