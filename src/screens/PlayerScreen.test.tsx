import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import PlayerScreen from "./PlayerScreen";

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
