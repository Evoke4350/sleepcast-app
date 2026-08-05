import { youtubeFeedUrl, isYouTubeFeedUrl } from "./youtube-url";

test("a /channel URL becomes a channel_id feed URL", () => {
  expect(youtubeFeedUrl("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv")).toEqual({
    kind: "feed",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv",
  });
});

test("a @handle is reported as a handle", () => {
  expect(youtubeFeedUrl("https://www.youtube.com/@sleepy")).toEqual({ kind: "handle", handle: "sleepy" });
});

test("a watch URL is unsupported (video, not channel)", () => {
  expect(youtubeFeedUrl("https://www.youtube.com/watch?v=abc")).toEqual({ kind: "unsupported", reason: "video" });
});

test("a non-YouTube URL is null", () => {
  expect(youtubeFeedUrl("https://example.com/feed")).toBeNull();
  expect(youtubeFeedUrl("https://youtube.com.evil.test/channel/UCx")).toBeNull(); // whole-host match
});

test("isYouTubeFeedUrl is true only for feed URLs", () => {
  expect(isYouTubeFeedUrl("https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv")).toBe(true);
  expect(isYouTubeFeedUrl("https://www.youtube.com/@sleepy")).toBe(false);
  expect(isYouTubeFeedUrl("https://feeds.example/rss")).toBe(false);
});
