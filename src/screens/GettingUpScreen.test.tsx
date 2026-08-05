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
