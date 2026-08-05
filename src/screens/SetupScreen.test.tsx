import "../platform/storage";
import { installLocalStorage } from "../platform/storage";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import SetupScreen from "./SetupScreen";
import { loadState, saveState } from "../../vendor/player/src/lib/store";
import { appendNight } from "../../vendor/player/src/lib/rest/ledger";
import { loadQuietUntil, loadStepBackAsked } from "../../vendor/player/src/lib/rest/ledger";

installLocalStorage();

function find(tree: TestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.findByProps({ testID });
}

test("adding a feed by URL persists it", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  act(() => { find(tree, "add-feed-input").props.onChangeText("https://feeds.example/x"); });
  act(() => { find(tree, "add-feed").props.onPress(); });
  expect(loadState().feeds.some((f) => f.url === "https://feeds.example/x")).toBe(true);
});

test("adding a YouTube channel URL resolves and stores the feed URL", async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  act(() => { find(tree, "add-feed-input").props.onChangeText("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"); });
  await act(async () => { await find(tree, "add-feed").props.onPress(); });
  expect(
    loadState().feeds.some(
      (f) => f.url === "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv"
    )
  ).toBe(true);
});

test("adding a YouTube video URL shows a feed error instead of adding a feed", async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  const before = loadState().feeds.length;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  act(() => { find(tree, "add-feed-input").props.onChangeText("https://www.youtube.com/watch?v=ABC123abcd0"); });
  await act(async () => { await find(tree, "add-feed").props.onPress(); });
  expect(loadState().feeds.length).toBe(before);
  expect(find(tree, "feed-error").props.children).toContain("video");
});

test("start-varied invokes onStart with the selected timer", () => {
  const onStart = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={onStart} />); });
  act(() => { find(tree, "timer-5").props.onPress(); });
  act(() => { find(tree, "start-varied").props.onPress(); });
  expect(onStart).toHaveBeenCalledWith("varied", 5);
});

test("resume button shows only when available", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} resumeAvailable={false} />); });
  expect(tree.root.findAllByProps({ testID: "start-resume" })).toHaveLength(0);
});

test("the nights link fires onOpenRest", () => {
  const onOpenRest = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} onOpenRest={onOpenRest} />); });
  act(() => { tree.root.findByProps({ testID: "open-rest" }).props.onPress(); });
  expect(onOpenRest).toHaveBeenCalled();
});

test("stepping a feed's trim up persists via nextTrim", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  // built-in "swm" starts at 1.0; one step up → 1.25
  act(() => { find(tree, "trim-up-swm").props.onPress(); });
  expect(loadState().settings.feedTrim.swm).toBe(1.25);
  expect(find(tree, "trim-value-swm").props.children).toContain("1.25");
});

test("the quarter-hour toggle persists the setting", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  act(() => { find(tree, "quarterhour-toggle").props.onValueChange(true); });
  expect(loadState().settings.quarterHourRule).toBe(true);
});

function seedGoodRun() {
  // 12 nights all slept fast (well under 20 min), no self-label "awake"
  for (let i = 0; i < 12; i++) {
    appendNight({ startedAt: 1000 + i, timerMinutes: 45, endedVia: "faded",
      sleptAtMs: 8 * 60_000, timeToSleepMs: 8 * 60_000, interactions: 1, detector: "inference" });
  }
}

// findAllByProps({testID}) double-counts a plain View here the same way it
// does elsewhere in this codebase (see __tests__/App.night.test.tsx): RN's
// View is a forwardRef wrapping a host node of the same name, so a deep
// props-only query matches both the wrapper and the host. findByProps
// (singular) forces deep:false and stops at the first match, so it doesn't
// double-count — use it as a presence check instead of counting.
function hasStepBackOffer(tree: TestRenderer.ReactTestRenderer): boolean {
  try { tree.root.findByProps({ testID: "stepback-offer" }); return true; } catch { return false; }
}

test("step-back offer appears only after a qualifying run", () => {
  localStorage.clear();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  expect(hasStepBackOffer(tree)).toBe(false); // no history
  seedGoodRun();
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  expect(hasStepBackOffer(tree)).toBe(true);
});

test("accepting step-back goes quiet and records the ask", () => {
  localStorage.clear();
  seedGoodRun();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  act(() => { tree.root.findByProps({ testID: "stepback-accept" }).props.onPress(); });
  expect(loadQuietUntil()).not.toBeNull();
  expect(loadStepBackAsked()).not.toBeNull();
  expect(hasStepBackOffer(tree)).toBe(false); // hidden after
});

test("declining step-back records the ask but stays loud", () => {
  localStorage.clear();
  seedGoodRun();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  act(() => { tree.root.findByProps({ testID: "stepback-decline" }).props.onPress(); });
  expect(loadQuietUntil()).toBeNull();
  expect(loadStepBackAsked()).not.toBeNull();
  expect(hasStepBackOffer(tree)).toBe(false); // card hides after declining too
});

test("enabling a YouTube feed alongside a podcast feed shows the mix warning and disables start", () => {
  const s = loadState();
  // "swm" is a builtin podcast feed, enabled by default. Add an enabled
  // YouTube feed alongside it so both kinds are live at once.
  const feeds = [...s.feeds, {
    id: "ytc",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv",
    title: "A Channel",
    builtin: false,
    enabled: true,
    skipIntroMin: 0,
  }];
  saveState({ ...s, feeds });

  const onStart = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={onStart} />); });

  expect(find(tree, "mix-warning")).toBeTruthy();
  expect(find(tree, "start-varied").props.disabled).toBe(true);
  act(() => { find(tree, "start-varied").props.onPress(); });
  expect(onStart).not.toHaveBeenCalled();
});

test("no mix warning when only one kind of feed is enabled", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  expect(tree.root.findAllByProps({ testID: "mix-warning" })).toHaveLength(0);
  expect(find(tree, "start-varied").props.disabled).toBeFalsy();
});
