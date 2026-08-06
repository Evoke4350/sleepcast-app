import React from "react";
import TestRenderer from "react-test-renderer";
import YouTubePlayer from "./YouTubePlayer.foss";

test("foss YouTube stub renders nothing", () => {
  let tree: TestRenderer.ReactTestRenderer;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<YouTubePlayer ref={React.createRef()} />);
  });
  expect(tree!.toJSON()).toBeNull();
});

test("foss stub source imports no youtube-iframe / webview runtime", () => {
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "YouTubePlayer.foss.tsx"),
    "utf8"
  );
  expect(src).not.toMatch(/from ["']react-native-youtube-iframe["']/);
  // a value import of webview; the type-only `import type ... webview` is fine
  expect(src).not.toMatch(/^import [^t].*from ["']react-native-webview["']/m);
});
