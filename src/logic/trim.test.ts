import { nextTrim, TRIM_STEPS } from "./trim";

test("steps up and down through the canonical trim steps", () => {
  expect(nextTrim(1.0, 1)).toBe(1.25);
  expect(nextTrim(1.0, -1)).toBe(0.75);
});

test("snaps an off-grid value to the nearest step before moving", () => {
  expect(nextTrim(0.9, 1)).toBe(1.25); // nearest is 1.0, then up
  expect(nextTrim(0.9, -1)).toBe(0.75); // nearest is 1.0, then down
});

test("clamps at the ends", () => {
  expect(nextTrim(TRIM_STEPS[TRIM_STEPS.length - 1], 1)).toBe(1.5);
  expect(nextTrim(TRIM_STEPS[0], -1)).toBe(0.5);
});
