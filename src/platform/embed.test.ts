import "./storage";
import { installLocalStorage } from "./storage";
import { meanPoolNormalize, makeEmbedder } from "./embed";

installLocalStorage();

test("mean-pools over the mask and L2-normalizes", () => {
  // dim=2, two tokens: [3,0] and [0,4], mask=[1,1] → mean [1.5,2] → normalized
  const hidden = Float32Array.from([3, 0, 0, 4]);
  const v = meanPoolNormalize(hidden, [1, 1], 2);
  const len = Math.hypot(v[0], v[1]);
  expect(len).toBeCloseTo(1, 5);
  expect(v[0] / v[1]).toBeCloseTo(1.5 / 2, 5);
});

test("masks padding out of the mean", () => {
  const hidden = Float32Array.from([2, 2, 9, 9]); // second token is padding
  const v = meanPoolNormalize(hidden, [1, 0], 2);
  expect(v[0]).toBeCloseTo(v[1], 5); // only first token counts → equal comps
});

test("embedTexts caches: a second call runs the session zero times", async () => {
  let runs = 0;
  const run = async (encs: any[]) => {
    runs += encs.length;
    return encs.map(() => Float32Array.from([1, 0]));
  };
  const embed = makeEmbedder(run, (t) => ({ inputIds: [t.length], attentionMask: [1], tokenTypeIds: [0] }));
  await embed(["night"]);
  await embed(["night"]); // served from sleepcast2.titlevecs
  expect(runs).toBe(1);
});

test("only missing titles are embedded", async () => {
  const seen: string[][] = [];
  const run = async (encs: any[]) => { seen.push(encs.map((e) => String(e.inputIds[0]))); return encs.map(() => Float32Array.from([0, 1])); };
  const embed = makeEmbedder(run, (t) => ({ inputIds: [t.length], attentionMask: [1], tokenTypeIds: [0] }));
  await embed(["aa"]);          // caches len-2
  await embed(["aa", "bbb"]);   // only "bbb" (len 3) is fresh
  expect(seen[1]).toEqual(["3"]);
});
