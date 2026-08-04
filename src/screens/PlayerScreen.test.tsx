import React from "react";
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
