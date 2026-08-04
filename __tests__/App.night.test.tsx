import "../src/platform/storage";
import { installLocalStorage } from "../src/platform/storage";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
// Real store module (not mocked) so the regression test below can assert on
// what App actually persisted.
import { loadLastNight } from "../vendor/player/src/lib/store";

installLocalStorage();

// Native audio module is absent under Jest; App must tolerate a null module.
jest.mock("../src/specs/NativeNightAudio", () => ({ getNightAudio: () => null }));
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

// Regression for the stale-closure bug: endSession used to read the `now`
// STATE, but the interval created in beginPlayback captured the closure from
// the render where `now` was still null (setup screen). So on timer-fade,
// `if (now)` was false and saveLastNight never ran — resume-after-fade
// silently never worked, even though manual stop (a fresh PlayerScreen
// closure) looked fine. This drives a real fade-to-zero and checks the
// ledger that only endSession's "faded" path writes.
test("resume-after-fade: the fade loop's endSession call saves last night", async () => {
  mockPoolResult = {
    pool: [{ id: "a", title: "A Quiet Night", url: "https://x/a.mp3", feedId: "f", date: "2024-01-01" }],
    feedTitles: { f: "F" }, errors: [],
  };
  jest.useFakeTimers();
  try {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => { tree = TestRenderer.create(<App />); });
    await act(async () => {}); // let buildPool resolve

    // Shortest available timer so the fade-to-zero doesn't require advancing
    // fake time by an unreasonable amount.
    await act(async () => { tree.root.findByProps({ testID: "timer-1" }).props.onPress(); });
    await act(async () => { tree.root.findByProps({ testID: "start-shuffle" }).props.onPress(); });
    expect(tree.root.findByProps({ testID: "nowPlaying" }).props.children).toBe("A Quiet Night");

    // Past the 1-minute timer: the interval's `left <= 0` branch fires and
    // calls endSession("faded"). advanceTimersByTimeAsync (not the sync
    // variant) lets the interval's own microtasks resolve between ticks.
    await act(async () => { await jest.advanceTimersByTimeAsync(61_000); });

    const last = loadLastNight();
    expect(last).not.toBeNull();
    expect(last?.playedIds).toContain("a");
    expect(last?.endedVia).toBe("faded");

    act(() => { tree.unmount(); });
  } finally {
    jest.useRealTimers();
  }
});
