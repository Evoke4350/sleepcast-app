// Per-feed volume-trim steps, reimplemented natively.
//
// The vendor `leveler.ts` exports these same pure helpers, but it also holds
// the `Leveler` class — a Web-Audio DynamicsCompressor over `window.AudioContext`
// — which neither typechecks (no DOM lib) nor runs on React Native. Importing
// `nextTrim` from there pulls those browser globals into the TS program and
// breaks `tsc`. So, exactly as `src/platform/feed.ts` and `src/platform/opml.ts`
// do for the DOM-bound parsers, the pure part is carried here. The values are a
// verbatim copy of the shared steps so the two cannot drift.
export const TRIM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5] as const;

export function nextTrim(current: number, direction: 1 | -1): number {
  // Snap to the nearest canonical step, then move one.
  let idx = 0;
  let best = Infinity;
  TRIM_STEPS.forEach((s, i) => {
    const d = Math.abs(s - current);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  const next = Math.min(TRIM_STEPS.length - 1, Math.max(0, idx + direction));
  return TRIM_STEPS[next];
}
