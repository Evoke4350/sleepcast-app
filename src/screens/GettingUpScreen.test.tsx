import React from "react";
import { Text } from "react-native";
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

test("accessibility: root has live region, title is header, dismiss is button with ok label", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<GettingUpScreen onDismiss={() => {}} />); });

  // Root has live region
  const root = tree.root.findByProps({ testID: "gettingup" });
  expect(root.props.accessibilityLiveRegion).toBe("polite");

  // Title is header (find all Text elements and look for the one with the title)
  const allText = tree.root.findAllByType(Text);
  const title = allText.find(n => n.props.children === "you've been up a while");
  expect(title).toBeTruthy();
  expect(title?.props.accessibilityRole).toBe("header");

  // Dismiss button has role and label
  const dismiss = tree.root.findByProps({ testID: "gettingup-dismiss" });
  expect(dismiss.props.accessibilityRole).toBe("button");
  expect(dismiss.props.accessibilityLabel).toBe("ok");
});
