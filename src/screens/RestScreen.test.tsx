import "../platform/storage";
import { installLocalStorage } from "../platform/storage";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import RestScreen from "./RestScreen";
import { appendNight, loadNights, loadParams, saveParams } from "../../vendor/player/src/lib/rest/ledger";
import { DEFAULT_PARAMS } from "../../vendor/player/src/lib/rest/detector";

installLocalStorage();

function seedSleptNight() {
  saveParams(DEFAULT_PARAMS); // so tightenAfterFalsePositive has params to tighten
  appendNight({
    startedAt: 1000, timerMinutes: 45, endedVia: "faded",
    sleptAtMs: 8 * 60_000, timeToSleepMs: 8 * 60_000, interactions: 2, detector: "inference",
  });
}

test("shows the drifted-off count from the ledger", () => {
  localStorage.clear();
  seedSleptNight();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<RestScreen onClose={() => {}} />); });
  expect(tree.root.findByProps({ testID: "rest-nights" }).props.children).toBe(1);
});

test("answering 'no' to a scored night tightens the detector", () => {
  localStorage.clear();
  seedSleptNight();
  const alpha0 = loadParams()!.alpha;
  const onClose = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<RestScreen onClose={onClose} />); });
  act(() => { tree.root.findByProps({ testID: "rest-label-no" }).props.onPress(); });
  const night = loadNights()[0];
  expect(night.selfLabel).toBe("awake");
  expect(loadParams()!.alpha).not.toBe(alpha0); // tightened
  expect(onClose).toHaveBeenCalled();
});
