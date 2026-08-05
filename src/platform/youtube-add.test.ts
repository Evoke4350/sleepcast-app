import { resolveYouTubeFeedUrl } from "./youtube-add";

test("a channel URL passes straight through", async () => {
  const r = await resolveYouTubeFeedUrl("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv");
  expect(r).toEqual({ ok: true, feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv" });
});

test("a @handle is resolved by fetching the channel page", async () => {
  const fetchText = async (url: string) => {
    expect(url).toBe("https://www.youtube.com/@sleepy");
    return `<link rel="canonical" href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv">`;
  };
  const r = await resolveYouTubeFeedUrl("https://www.youtube.com/@sleepy", fetchText);
  expect(r).toEqual({ ok: true, feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv" });
});

test("a video URL reports 'video'", async () => {
  expect(await resolveYouTubeFeedUrl("https://www.youtube.com/watch?v=abc")).toEqual({ ok: false, reason: "video" });
});

test("a non-YouTube URL reports 'not-youtube'", async () => {
  expect(await resolveYouTubeFeedUrl("https://example.com/feed")).toEqual({ ok: false, reason: "not-youtube" });
});

test("a handle page with no channel id reports 'unresolved'", async () => {
  const fetchText = async () => `<html><head><title>nothing useful here</title></head></html>`;
  expect(await resolveYouTubeFeedUrl("https://www.youtube.com/@ghost", fetchText)).toEqual({ ok: false, reason: "unresolved" });
});

test("a failed fetch reports 'unresolved' rather than throwing", async () => {
  const fetchText = async () => { throw new Error("offline"); };
  expect(await resolveYouTubeFeedUrl("https://www.youtube.com/@sleepy", fetchText)).toEqual({ ok: false, reason: "unresolved" });
});
