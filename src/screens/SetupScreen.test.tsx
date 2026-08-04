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
