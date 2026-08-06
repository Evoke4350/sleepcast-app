const path = require("path");
const { fossResolveRequest } = require("./metro-foss-resolve");

function fakeContext(filePath) {
  return { resolveRequest: () => ({ type: "sourceFile", filePath }) };
}
const abs = (p) => path.join(__dirname, p);

afterEach(() => { delete process.env.SLEEPCAST_FOSS; });

test("swaps the three modules to .foss when SLEEPCAST_FOSS=1", () => {
  process.env.SLEEPCAST_FOSS = "1";
  const cases = [
    ["src/features.ts", "src/features.foss.ts"],
    ["src/platform/embed.ts", "src/platform/embed.foss.ts"],
    ["src/youtube/YouTubePlayer.tsx", "src/youtube/YouTubePlayer.foss.tsx"],
  ];
  for (const [from, to] of cases) {
    const res = fossResolveRequest(fakeContext(abs(from)), "irrelevant", "android");
    expect(res.filePath).toBe(abs(to));
  }
});

test("leaves resolution unchanged without the env", () => {
  const res = fossResolveRequest(fakeContext(abs("src/features.ts")), "x", "android");
  expect(res.filePath).toBe(abs("src/features.ts"));
});

test("does not touch unrelated modules even under foss", () => {
  process.env.SLEEPCAST_FOSS = "1";
  const res = fossResolveRequest(fakeContext(abs("src/logic/selection.ts")), "x", "android");
  expect(res.filePath).toBe(abs("src/logic/selection.ts"));
});
