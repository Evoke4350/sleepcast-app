import * as full from "./features";
import * as foss from "./features.foss";

test("full build enables YouTube", () => {
  expect(full.YOUTUBE).toBe(true);
});

test("foss build disables YouTube", () => {
  expect(foss.YOUTUBE).toBe(false);
});
