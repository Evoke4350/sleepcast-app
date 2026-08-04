export interface Encoding {
  inputIds: number[];
  attentionMask: number[];
  tokenTypeIds: number[];
}

export function loadVocab(vocabText: string): Map<string, number> {
  const m = new Map<string, number>();
  vocabText.split("\n").forEach((tok, i) => {
    const t = tok.replace(/\r$/, "");
    if (t.length) m.set(t, i);
  });
  return m;
}

// Whitespace + punctuation split, lowercase — BERT basic tokenizer, uncased.
function basicTokenize(text: string): string[] {
  const lowered = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const out: string[] = [];
  for (const chunk of lowered.split(/\s+/)) {
    if (!chunk) continue;
    let buf = "";
    for (const ch of chunk) {
      if (/[^\p{L}\p{N}]/u.test(ch)) {
        if (buf) { out.push(buf); buf = ""; }
        out.push(ch); // punctuation is its own token
      } else {
        buf += ch;
      }
    }
    if (buf) out.push(buf);
  }
  return out;
}

// Greedy longest-match WordPiece.
function wordPiece(word: string, vocab: Map<string, number>, unk: number): number[] {
  if (vocab.has(word)) return [vocab.get(word)!];
  const ids: number[] = [];
  let start = 0;
  while (start < word.length) {
    let end = word.length;
    let cur = -1;
    while (start < end) {
      const sub = (start === 0 ? "" : "##") + word.slice(start, end);
      if (vocab.has(sub)) { cur = vocab.get(sub)!; break; }
      end--;
    }
    if (cur === -1) return [unk]; // any un-piece-able part → whole word UNK
    ids.push(cur);
    start = end;
  }
  return ids;
}

export function makeTokenizer(vocab: Map<string, number>, maxLen = 128) {
  const CLS = vocab.get("[CLS]") ?? 101;
  const SEP = vocab.get("[SEP]") ?? 102;
  const PAD = vocab.get("[PAD]") ?? 0;
  const UNK = vocab.get("[UNK]") ?? 100;

  return function encode(text: string): Encoding {
    const pieces: number[] = [];
    for (const w of basicTokenize(text)) {
      for (const id of wordPiece(w, vocab, UNK)) pieces.push(id);
    }
    // Reserve room for [CLS] ... [SEP].
    const body = pieces.slice(0, maxLen - 2);
    const ids = [CLS, ...body, SEP];
    const attn = ids.map(() => 1);
    while (ids.length < maxLen) { ids.push(PAD); attn.push(0); }
    return { inputIds: ids, attentionMask: attn, tokenTypeIds: ids.map(() => 0) };
  };
}
