import "../platform/storage";
import { installLocalStorage } from "../platform/storage";
import { chooseLineup, resumeNight } from "./selection";
import { saveLastNight } from "../../vendor/player/src/lib/store";
import type { Episode } from "../../vendor/player/src/lib/engine";

installLocalStorage();

const ep = (id: string, feedId = "f", date = "2024-01-01"): Episode =>
  ({ id, title: id, url: `https://x/${id}.mp3`, feedId, date } as Episode);
const POOL = [ep("a"), ep("b"), ep("c", "g"), ep("d", "g", "2020-01-01")];

test("shuffle returns a single lead from the pool", async () => {
  const r = await chooseLineup("shuffle", POOL, { rand: () => 0 });
  expect(r!.lead.id).toBeDefined();
  expect(POOL.map((e) => e.id)).toContain(r!.lead.id);
  expect(r!.wasVaried).toBe(false);
});

test("varied embeds titles and picks a diverse lineup", async () => {
  const embed = async (titles: string[]) =>
    titles.map((t, i) => Float32Array.from([Math.cos(i), Math.sin(i)])); // spread-out fake vecs
  const r = await chooseLineup("varied", POOL, { embed, rand: () => 0 });
  expect(r!.wasVaried).toBe(true);
  expect(r!.lineup.length).toBeGreaterThan(0);
});

test("varied falls back to the spread when embedding times out", async () => {
  const embed = () => new Promise<Float32Array[]>(() => {}); // never resolves
  const r = await chooseLineup("varied", POOL, { embed, rand: () => 0, timeoutMs: 5 });
  expect(r!.wasVaried).toBe(true); // still counts as a varied intent
  expect(r!.lead.id).toBeDefined();
});

test("varied falls back to the spread when embedding rejects", async () => {
  const embed = async () => {
    throw new Error("model unavailable");
  };
  const r = await chooseLineup("varied", POOL, { embed, rand: () => 0 });
  expect(r!.wasVaried).toBe(true); // the intent was varied; the spread stood in
  expect(r!.lead.id).toBeDefined();
  expect(r!.lineup.length).toBeGreaterThan(0);
});

test("returns null for an empty pool", async () => {
  expect(await chooseLineup("shuffle", [], {})).toBeNull();
});

test("resume offers the next spread episode within the rearm window", () => {
  saveLastNight({
    pool: POOL, playedIds: ["a"], feedTitles: {}, artworkByFeedId: {},
    skipIntroByFeedId: {}, endedVia: "faded", endedAt: 1000, wasVaried: false,
  });
  const r = resumeNight(60, { now: () => 1000 + 60_000 }); // one minute later
  expect(r).not.toBeNull();
  expect(["b", "c", "d"]).toContain(r!.lead.id);
  expect(r!.minutes).toBe(30); // rearmMinutes(60)
});

test("resume declines outside the rearm window", () => {
  saveLastNight({
    pool: POOL, playedIds: [], feedTitles: {}, artworkByFeedId: {},
    skipIntroByFeedId: {}, endedVia: "faded", endedAt: 0, wasVaried: false,
  });
  expect(resumeNight(60, { now: () => 999_999_999 })).toBeNull();
});
