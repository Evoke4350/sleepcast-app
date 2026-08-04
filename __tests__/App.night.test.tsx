import "../src/platform/storage";
import { installLocalStorage } from "../src/platform/storage";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

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
