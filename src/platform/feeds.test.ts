import "./storage"; // installs the MMKV-backed localStorage shim used by store.ts
import { installLocalStorage } from "./storage";
import { buildPool } from "./feeds";
import { saveState, loadState, cacheFeedXml } from "../../vendor/player/src/lib/store";

installLocalStorage();

const FEED_A = `<rss><channel><title>A</title>
  <item><title>A1</title><enclosure url="https://a/1.mp3"/><guid>a1</guid></item>
</channel></rss>`;
const FEED_B = `<rss><channel><title>B</title>
  <item><title>B1</title><enclosure url="https://b/1.mp3"/><guid>b1</guid></item>
</channel></rss>`;

function twoEnabledFeeds() {
  const s = loadState();
  // Disable every builtin (keep their ids so loadState's merge keeps them disabled),
  // then append two custom feeds with known ids we control.
  const feeds = s.feeds.map((f) => ({ ...f, enabled: false }));
  feeds.push({ id: "fa", url: "https://a", title: "A", builtin: false, enabled: true, skipIntroMin: 0 });
  feeds.push({ id: "fb", url: "https://b", title: "B", builtin: false, enabled: true, skipIntroMin: 0 });
  saveState({ ...s, feeds });
}

test("concatenates episodes from every enabled feed", async () => {
  twoEnabledFeeds();
  const fetchXml = async (url: string) => (url === "https://a" ? FEED_A : FEED_B);
  const { pool, errors } = await buildPool(fetchXml);
  expect(errors).toEqual([]);
  expect(pool.map((e) => e.title).sort()).toEqual(["A1", "B1"]);
});

test("falls back to cached xml when a fetch fails", async () => {
  twoEnabledFeeds();
  cacheFeedXml("fa", FEED_A); // fa is cached from a previous night
  const fetchXml = async (url: string) => {
    if (url === "https://a") throw new Error("offline");
    return FEED_B;
  };
  const { pool, errors } = await buildPool(fetchXml);
  expect(pool.map((e) => e.title).sort()).toEqual(["A1", "B1"]);
  expect(errors).toEqual([]); // cache hit is not an error
});

test("records an error and drops a feed with neither network nor cache", async () => {
  twoEnabledFeeds();
  const fetchXml = async (url: string) => {
    if (url === "https://a") throw new Error("offline");
    return FEED_B;
  };
  const { pool, errors } = await buildPool(fetchXml);
  expect(pool.map((e) => e.title)).toEqual(["B1"]);
  expect(errors).toHaveLength(1);
});

const YT_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>A Channel</title>
  <entry>
    <id>yt:video:ABC123abcd0</id>
    <yt:videoId>ABC123abcd0</yt:videoId>
    <title>Sleepy Rain</title>
    <published>2024-01-01T00:00:00+00:00</published>
  </entry>
</feed>`;

test("a YouTube feed URL parses its cached xml into episodes with youtubeId", async () => {
  const s = loadState();
  const feeds = s.feeds.map((f) => ({ ...f, enabled: false }));
  feeds.push({
    id: "ytc",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv",
    title: "A Channel",
    builtin: false,
    enabled: true,
    skipIntroMin: 0,
  });
  saveState({ ...s, feeds });

  const fetchXml = async () => YT_ATOM;
  const { pool, errors } = await buildPool(fetchXml);
  expect(errors).toEqual([]);
  expect(pool).toHaveLength(1);
  expect(pool[0].youtubeId).toBe("ABC123abcd0");
  expect(pool[0].title).toBe("Sleepy Rain");
});
