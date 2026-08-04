import { makeTokenizer, loadVocab } from "./tokenizer";

// A tiny hand-built vocab exercising WordPiece continuation ("##").
const VOCAB = loadVocab(
  ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "sleep", "##ing", "cast", "the", "quiet"].join("\n")
);
// ids: PAD0 UNK1 CLS2 SEP3 sleep4 ##ing5 cast6 the7 quiet8

test("wraps tokens with [CLS]/[SEP] and lowercases", () => {
  const enc = makeTokenizer(VOCAB, 8)("The quiet");
  // [CLS] the quiet [SEP] then pad to 8
  expect(enc.inputIds).toEqual([2, 7, 8, 3, 0, 0, 0, 0]);
  expect(enc.attentionMask).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  expect(enc.tokenTypeIds).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test("splits a word into WordPiece continuations", () => {
  const enc = makeTokenizer(VOCAB, 6)("sleeping");
  // sleep + ##ing
  expect(enc.inputIds.slice(0, 4)).toEqual([2, 4, 5, 3]);
});

test("maps an unknown word to [UNK]", () => {
  const enc = makeTokenizer(VOCAB, 4)("zzz");
  expect(enc.inputIds).toEqual([2, 1, 3, 0]);
});

test("truncates to maxLen keeping [SEP] last", () => {
  const enc = makeTokenizer(VOCAB, 3)("the quiet cast");
  expect(enc.inputIds).toEqual([2, 7, 3]); // [CLS] the [SEP]
  expect(enc.inputIds.length).toBe(3);
});
