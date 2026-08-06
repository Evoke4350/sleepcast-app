import { embedTexts } from "./embed.foss";
import { cosine, diversePick } from "../../vendor/player/src/lib/semantic-math";

test("returns one L2-normalized vector per title", async () => {
  const vecs = await embedTexts(["calm sleep meditation", "quantum physics lecture"]);
  expect(vecs).toHaveLength(2);
  for (const v of vecs) {
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  }
});

test("titles sharing words are closer than disjoint titles", async () => {
  const [a, b, c] = await embedTexts([
    "calm sleep meditation",
    "calm sleep stories",
    "quantum physics lecture",
  ]);
  expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
});

test("feeds diversePick to yield N distinct picks", async () => {
  const titles = ["ocean waves", "rain forest", "city hum", "deep space", "warm fire"];
  const vecs = await embedTexts(titles);
  const picks = diversePick(vecs, 3, () => 0);
  expect(new Set(picks).size).toBe(3);
});

test("reports progress once per title, ending at (N, N)", async () => {
  const calls: Array<[number, number]> = [];
  await embedTexts(["a title", "b title", "c title"], (d, t) => calls.push([d, t]));
  expect(calls).toHaveLength(3);
  expect(calls[calls.length - 1]).toEqual([3, 3]);
});

test("empty input returns empty array", async () => {
  expect(await embedTexts([])).toEqual([]);
});
