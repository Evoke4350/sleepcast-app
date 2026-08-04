// Fidelity check against the REAL shipped vocab (src/assets/minilm/vocab.txt),
// not the tiny hand-built vocab in tokenizer.test.ts. Ground-truth ids were
// read directly from that vocab file (line index = token id), so this pins the
// whole pipeline — vocab load, lowercasing, basic split, and greedy WordPiece —
// to the exact asset the model runs against. If the vocab or the algorithm
// drifts, these break.
import fs from "fs";
import path from "path";
import { makeTokenizer, loadVocab } from "./tokenizer";

const vocabTxt = fs.readFileSync(
  path.join(__dirname, "../assets/minilm/vocab.txt"),
  "utf8"
);
const encode = makeTokenizer(loadVocab(vocabTxt), 32);

// Non-pad prefix of the encoding (the real tokens, [CLS]…[SEP]).
function ids(text: string): number[] {
  const enc = encode(text);
  const len = enc.attentionMask.filter((x) => x).length;
  return enc.inputIds.slice(0, len);
}

// ids below are ground-truth from vocab.txt: [CLS]=101 [SEP]=102, a=1037,
// quiet=4251, night=2305, the=1996, podcast=16110, sleep=3637, ##cast=10526.
test("whole-word titles map to their vocab ids", () => {
  expect(ids("a quiet night")).toEqual([101, 1037, 4251, 2305, 102]);
});

test("a word absent from the vocab splits into WordPiece continuations", () => {
  // "sleepcast" is not a vocab entry; greedy longest-match yields sleep + ##cast.
  expect(ids("sleepcast")).toEqual([101, 3637, 10526, 102]);
});

test("a word present as a single token is not split", () => {
  // "podcast" exists whole (16110), so it must not become pod + ##cast.
  expect(ids("the podcast")).toEqual([101, 1996, 16110, 102]);
});

test("mask and type-id lengths always equal inputIds", () => {
  const enc = encode("a quiet night");
  expect(enc.attentionMask).toHaveLength(enc.inputIds.length);
  expect(enc.tokenTypeIds).toHaveLength(enc.inputIds.length);
});
