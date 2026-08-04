import { parseOpml, buildOpml } from "./opml";

describe("parseOpml", () => {
  it("reads feeds from a flat OPML document", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>feeds</title></head>
  <body>
    <outline type="rss" text="Sleep With Me" xmlUrl="https://x/swm.xml" />
    <outline type="rss" text="Nothing Much Happens" xmlUrl="https://x/nmh.xml" />
  </body>
</opml>`;
    const feeds = parseOpml(xml);
    expect(feeds).toEqual([
      { url: "https://x/swm.xml", title: "Sleep With Me" },
      { url: "https://x/nmh.xml", title: "Nothing Much Happens" },
    ]);
  });

  it("finds feeds nested inside a folder outline", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>feeds</title></head>
  <body>
    <outline text="Folder">
      <outline type="rss" text="Sleep With Me" xmlUrl="https://x/swm.xml" />
    </outline>
  </body>
</opml>`;
    const feeds = parseOpml(xml);
    expect(feeds).toEqual([{ url: "https://x/swm.xml", title: "Sleep With Me" }]);
  });

  it("falls back from text to title to null", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline type="rss" title="Only Title" xmlUrl="https://x/a.xml" />
    <outline type="rss" xmlUrl="https://x/b.xml" />
  </body>
</opml>`;
    const feeds = parseOpml(xml);
    expect(feeds).toEqual([
      { url: "https://x/a.xml", title: "Only Title" },
      { url: "https://x/b.xml", title: null },
    ]);
  });

  it("throws on a non-OPML document", () => {
    expect(() => parseOpml("<rss><channel></channel></rss>")).toThrow("not an OPML document");
  });

  it("round-trips through buildOpml", () => {
    const feeds = [
      { url: "https://x/swm.xml", title: "Sleep With Me" },
      { url: "https://x/nmh.xml", title: "Nothing Much Happens" },
    ];
    const parsed = parseOpml(buildOpml(feeds));
    expect(parsed).toEqual(feeds);
  });
});
