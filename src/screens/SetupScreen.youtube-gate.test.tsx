import React from "react";
import TestRenderer from "react-test-renderer";

jest.mock("../features", () => ({ YOUTUBE: false }));
// Fail loudly if the gate lets a YouTube URL reach the resolver network call:
jest.mock("../platform/youtube-add", () => ({
  resolveYouTubeFeedUrl: jest.fn(() => {
    throw new Error("resolveYouTubeFeedUrl must not be called when YOUTUBE is off");
  }),
}));

import SetupScreen from "./SetupScreen";
import { resolveYouTubeFeedUrl } from "../platform/youtube-add";

function findByTestID(node: any, id: string): any {
  return node.root.findAll((n: any) => n.props?.testID === id)[0];
}

test("with YouTube off, a YouTube URL is rejected and never resolved", async () => {
  let tr: TestRenderer.ReactTestRenderer;
  await TestRenderer.act(async () => {
    tr = TestRenderer.create(
      <SetupScreen onStart={() => {}} onResume={() => {}} resumeAvailable={false} onOpenRest={() => {}} />
    );
  });
  const input = findByTestID(tr!, "add-feed-input");
  await TestRenderer.act(async () => input.props.onChangeText("https://youtube.com/@LofiGirl"));
  const addBtn = findByTestID(tr!, "add-feed");
  await TestRenderer.act(async () => { await addBtn.props.onPress(); });

  expect(resolveYouTubeFeedUrl).not.toHaveBeenCalled();
  const err = findByTestID(tr!, "feed-error");
  expect(err.props.children).toMatch(/youtube/i);
});
