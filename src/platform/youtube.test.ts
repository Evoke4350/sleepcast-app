import { parseYouTubeFeed, parseFeedFor } from "./youtube";

const YT_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>A Channel</title>
  <entry>
    <id>yt:video:ABC123abcd0</id>
    <yt:videoId>ABC123abcd0</yt:videoId>
    <title>Sleepy Rain</title>
    <published>2024-01-01T00:00:00+00:00</published>
    <media:group><media:thumbnail url="https://i.ytimg.com/x.jpg"/></media:group>
  </entry>
  <entry>
    <id>yt:video:ZZZ999zzzz9</id>
    <yt:videoId>ZZZ999zzzz9</yt:videoId>
    <title>Ocean</title>
    <published>2024-02-01T00:00:00+00:00</published>
  </entry>
</feed>`;

test("parses a YouTube Atom feed into episodes with youtubeId", () => {
  const feed = parseYouTubeFeed(YT_ATOM, "ytc");
  expect(feed.title).toBe("A Channel");
  expect(feed.episodes.map((e) => e.youtubeId)).toEqual(["ABC123abcd0", "ZZZ999zzzz9"]);
  expect(feed.episodes[0].title).toBe("Sleepy Rain");
  expect(feed.episodes[0].url).toContain("watch?v=ABC123abcd0");
  expect(feed.episodes[0].feedId).toBe("ytc");
});

test("channel artwork is the first thumbnail found, even if entry 1 lacks one", () => {
  const feed = parseYouTubeFeed(YT_ATOM, "ytc"); // entry 1 has no thumbnail, entry 2... none either here
  // entry 1 has a thumbnail in YT_ATOM's first entry, so this asserts it is used
  expect(feed.artwork).toBe("https://i.ytimg.com/x.jpg");
});

test("artwork falls to a later entry when the first has none", () => {
  const xml = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
    <title>C</title>
    <entry><id>yt:video:aaaaaaaaaa0</id><yt:videoId>aaaaaaaaaa0</yt:videoId><title>one</title></entry>
    <entry><id>yt:video:bbbbbbbbbb0</id><yt:videoId>bbbbbbbbbb0</yt:videoId><title>two</title><media:group><media:thumbnail url="https://i.ytimg.com/second.jpg"/></media:group></entry>
  </feed>`;
  expect(parseYouTubeFeed(xml, "ytc").artwork).toBe("https://i.ytimg.com/second.jpg");
});

test("parseFeedFor routes YouTube feed URLs to the YouTube parser", () => {
  const feed = parseFeedFor(YT_ATOM, "ytc", "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv");
  expect(feed.episodes[0].youtubeId).toBe("ABC123abcd0");
});
