import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import PlayerScreen from "./PlayerScreen";

const EP = (id: string, title: string, feedId = "f") => ({ id, title, url: `https://x/${id}.mp3`, feedId, date: "2024-01-01" });
const LINEUP = [EP("a", "First Night"), EP("b", "Second Night", "g"), EP("c", "Third Night")] as any;

test("renders title and countdown, fires onStop", () => {
  const onStop = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<PlayerScreen title="A Quiet Night" remaining={90} volume={0.5} onStop={onStop} />); });
  expect(tree.root.findByProps({ testID: "nowPlaying" }).props.children).toBe("A Quiet Night");
  expect(tree.root.findByProps({ testID: "countdown" }).props.children).toBe("1:30");
  act(() => { tree.root.findByProps({ testID: "stop" }).props.onPress(); });
  expect(onStop).toHaveBeenCalled();
});

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

test("accessibility: moon is hidden, title is header, stop is button, countdown and volume have labels", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<PlayerScreen title="A Night" remaining={295} volume={0.75} onStop={() => {}} />); });

  // Moon is decorative-hidden (find it by finding all Text elements and looking for the one with ☾)
  const allText = tree.root.findAllByType(Text);
  const moon = allText.find(n => n.props.children === "☾");
  expect(moon).toBeTruthy();
  expect(moon?.props.accessibilityElementsHidden).toBe(true);
  expect(moon?.props.importantForAccessibility).toBe("no-hide-descendants");

  // Title is header
  const title = tree.root.findByProps({ testID: "nowPlaying" });
  expect(title.props.accessibilityRole).toBe("header");

  // Stop button has role and label
  const stop = tree.root.findByProps({ testID: "stop" });
  expect(stop.props.accessibilityRole).toBe("button");
  expect(stop.props.accessibilityLabel).toBe("stop");

  // Countdown has label
  const countdown = tree.root.findByProps({ testID: "countdown" });
  expect(countdown.props.accessibilityLabel).toBeTruthy();
  expect(countdown.props.accessibilityLabel).toMatch(/remaining/);

  // Volume has label
  const volume = tree.root.findByProps({ testID: "volume" });
  expect(volume.props.accessibilityLabel).toBeTruthy();
  expect(volume.props.accessibilityLabel).toMatch(/volume/);
});

test("a multi-episode lineup renders a labelled, tappable list plus a next button", () => {
  const onSelect = jest.fn();
  const onNext = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <PlayerScreen
        title="First Night" remaining={90} volume={1} onStop={() => {}}
        lineup={LINEUP} currentId="a" feedTitles={{ f: "Feed F", g: "Feed G" }}
        onSelect={onSelect} onNext={onNext}
      />
    );
  });
  // one row per pick
  const rows = tree.root.findAllByProps({ testID: "lineup-row-b" });
  expect(rows.length).toBeGreaterThan(0);
  const rowB = tree.root.findByProps({ testID: "lineup-row-b" });
  expect(rowB.props.accessibilityRole).toBe("button");
  expect(rowB.props.accessibilityLabel).toMatch(/Second Night/);
  expect(rowB.props.accessibilityState.selected).toBe(false);
  // current row marked selected
  const rowA = tree.root.findByProps({ testID: "lineup-row-a" });
  expect(rowA.props.accessibilityState.selected).toBe(true);
  // tapping a non-current row jumps to it
  act(() => { rowB.props.onPress(); });
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  // next button
  const next = tree.root.findByProps({ testID: "skip-next" });
  expect(next.props.accessibilityLabel).toMatch(/next/i);
  act(() => { next.props.onPress(); });
  expect(onNext).toHaveBeenCalled();
});

test("a single-episode lineup (shuffle) renders no list or next", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <PlayerScreen title="Solo" remaining={90} volume={1} onStop={() => {}} lineup={[EP("a", "Solo")] as any} currentId="a" />
    );
  });
  expect(tree.root.findAllByProps({ testID: "skip-next" })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: "lineup-row-a" })).toHaveLength(0);
});

test("no lineup prop is backward compatible (no list, no crash)", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<PlayerScreen title="A" remaining={90} volume={1} onStop={() => {}} />); });
  expect(tree.root.findAllByProps({ testID: "skip-next" })).toHaveLength(0);
});
