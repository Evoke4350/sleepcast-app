import { parseFeed } from "./feed";

const rss = (items: string, channelExtra = "") => `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Sleep With Me</title>
    ${channelExtra}
    ${items}
  </channel>
</rss>`;

const item = (inner: string) => `<item>${inner}</item>`;

describe("parseFeed", () => {
  it("reads title, id, url and date from an item", () => {
    const f = parseFeed(rss(item(`
      <title>The Slow Train</title>
      <guid>abc-123</guid>
      <pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate>
      <enclosure url="https://x/ep.mp3" type="audio/mpeg"/>
    `)), "swm");
    expect(f.title).toBe("Sleep With Me");
    expect(f.episodes).toHaveLength(1);
    expect(f.episodes[0]).toEqual({
      id: "abc-123",
      title: "The Slow Train",
      url: "https://x/ep.mp3",
      feedId: "swm",
      date: "Mon, 01 Jan 2026 00:00:00 GMT",
    });
  });

  it("skips an item with no enclosure — no audio, no episode", () => {
    const f = parseFeed(rss(item("<title>Just a note</title>")), "swm");
    expect(f.episodes).toEqual([]);
  });

  it("falls back to the url when guid is absent", () => {
    const f = parseFeed(rss(item(`<enclosure url="https://x/a.mp3"/>`)), "swm");
    expect(f.episodes[0].id).toBe("https://x/a.mp3");
  });

  it("falls back to untitled and an empty date", () => {
    const f = parseFeed(rss(item(`<enclosure url="https://x/a.mp3"/>`)), "swm");
    expect(f.episodes[0].title).toBe("untitled");
    expect(f.episodes[0].date).toBe("");
  });

  it("handles a single-item channel as an array", () => {
    // The bug this guards: XML parsers hand back an object for one item and an
    // array for two, so code that works on a busy feed crashes on a new one.
    const one = parseFeed(rss(item(`<enclosure url="https://x/1.mp3"/>`)), "f");
    const two = parseFeed(
      rss(item(`<enclosure url="https://x/1.mp3"/>`) + item(`<enclosure url="https://x/2.mp3"/>`)),
      "f",
    );
    expect(one.episodes).toHaveLength(1);
    expect(two.episodes).toHaveLength(2);
  });

  it("prefers itunes:image over the legacy image element", () => {
    const f = parseFeed(
      rss(item(`<enclosure url="https://x/a.mp3"/>`),
        `<itunes:image href="https://x/art.jpg"/><image><url>https://x/old.jpg</url></image>`),
      "swm",
    );
    expect(f.artwork).toBe("https://x/art.jpg");
  });

  it("survives a feed with no items at all", () => {
    const f = parseFeed(rss(""), "swm");
    expect(f.episodes).toEqual([]);
    expect(f.title).toBe("Sleep With Me");
  });
});
