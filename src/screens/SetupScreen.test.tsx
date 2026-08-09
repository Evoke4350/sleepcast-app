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

test("a now-playing banner shows the title + countdown and taps back to the player", () => {
  const onReturnToPlayer = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SetupScreen onStart={() => {}} nowPlaying={{ title: "A Quiet Night", remaining: 185 }} onReturnToPlayer={onReturnToPlayer} />
    );
  });
  const banner = find(tree, "now-playing-banner");
  expect(banner.props.accessibilityRole).toBe("button");
  expect(banner.props.accessibilityLabel).toMatch(/A Quiet Night/);
  // title + formatted countdown are visible somewhere in the banner subtree
  const texts = banner.findAllByType(require("react-native").Text).map((t: any) => t.props.children);
  expect(texts.join(" ")).toMatch(/A Quiet Night/);
  expect(texts.join(" ")).toMatch(/3:05/); // formatTime(185)
  act(() => { banner.props.onPress(); });
  expect(onReturnToPlayer).toHaveBeenCalled();
});

test("no now-playing prop renders no banner", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  expect(tree.root.findAllByProps({ testID: "now-playing-banner" })).toHaveLength(0);
});

test("the all-night chip renders, selects, and persists the all-night flag", () => {
  localStorage.removeItem("sleepcast2.allnight");
  const onStart = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={onStart} />); });
  const chip = find(tree, "timer-all-night");
  expect(chip.props.accessibilityLabel).toMatch(/all night/i);
  act(() => { chip.props.onPress(); });
  // starting uses the sentinel, and the flag persists (vendor saveTimerMinutes can't hold -1)
  act(() => { find(tree, "start-shuffle").props.onPress(); });
  expect(onStart).toHaveBeenCalledWith("shuffle", -1);
  expect(localStorage.getItem("sleepcast2.allnight")).toBe("1");
});

test("a fresh mount restores all-night from the flag", () => {
  localStorage.setItem("sleepcast2.allnight", "1");
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} />); });
  expect(find(tree, "timer-all-night").props.accessibilityState.selected).toBe(true);
  localStorage.removeItem("sleepcast2.allnight");
});

test("the banner shows 'all night' when allNight is set", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SetupScreen onStart={() => {}} nowPlaying={{ title: "A", remaining: 100, allNight: true }} onReturnToPlayer={() => {}} />
    );
  });
  const banner = find(tree, "now-playing-banner");
  const texts = banner.findAllByType(require("react-native").Text).flatMap((t: any) => [t.props.children].flat());
  expect(texts.join(" ")).toMatch(/all night/);
});

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

test("toggling a feed notifies the parent so the episode pool can rebuild", () => {
  // Regression: the pool was built once at App mount and never rebuilt when the
  // user enabled another feed, so only the launch-default feed (Sleep With Me)
  // ever appeared in the mix. SetupScreen must signal feed-set changes upward.
  const onFeedsChanged = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} onFeedsChanged={onFeedsChanged} />); });
  act(() => { find(tree, "feed-toggle-swm").props.onValueChange(false); });
  expect(onFeedsChanged).toHaveBeenCalled();
});

test("adding a feed also notifies the parent to rebuild the pool", () => {
  const onFeedsChanged = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} onFeedsChanged={onFeedsChanged} />); });
  act(() => { find(tree, "add-feed-input").props.onChangeText("https://feeds.example/rebuild"); });
  act(() => { find(tree, "add-feed").props.onPress(); });
  expect(onFeedsChanged).toHaveBeenCalled();
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

test("controls expose accessibility labels/roles", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} onOpenRest={() => {}} />); });
  const toggle = find(tree, "feed-toggle-swm");
  expect(toggle.props.accessibilityLabel).toMatch(/Sleep With Me/i);
  const up = find(tree, "trim-up-swm");
  expect(up.props.accessibilityRole).toBe("button");
  expect(up.props.accessibilityLabel).toMatch(/louder/i);
  const val = find(tree, "trim-value-swm");
  expect(val.props.accessibilityRole).toBe("adjustable");
  expect(val.props.accessibilityValue?.text).toMatch(/times|×|1\.00/);
  const t5 = find(tree, "timer-5");
  expect(t5.props.accessibilityRole).toBe("button");
  const shuffle = find(tree, "start-shuffle");
  expect(shuffle.props.accessibilityLabel).toMatch(/shuffle/i);
});
