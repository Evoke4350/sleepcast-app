import "../platform/storage";
import { installLocalStorage } from "../platform/storage";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import SetupScreen from "./SetupScreen";
import { loadState } from "../../vendor/player/src/lib/store";

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
