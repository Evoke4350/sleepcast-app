// Load the module under a forced Platform.OS so we can assert BOTH branches
// regardless of what the RN jest preset defaults to. Uses Object.defineProperty
// scoped to this test file to avoid global mocks that would break other tests.
function loadTokens(os: "ios" | "android") {
  let t: typeof import("./tokens").default;
  jest.isolateModules(() => {
    const RN = require("react-native");
    // Override Platform.OS just for this module load
    const originalDescriptor = Object.getOwnPropertyDescriptor(RN.Platform, "OS");
    Object.defineProperty(RN.Platform, "OS", {
      configurable: true,
      value: os,
    });
    try {
      t = require("./tokens").default;
    } finally {
      // Restore original descriptor
      if (originalDescriptor) {
        Object.defineProperty(RN.Platform, "OS", originalDescriptor);
      } else {
        delete (RN.Platform as any).OS;
      }
    }
  });
  return t!;
}

test("space scale is 4-based", () => {
  const t = loadTokens("ios");
  expect(t.space(0)).toBe(0);
  expect(t.space(4)).toBe(16);
  expect(t.space(6)).toBe(24);
});

test("android color values equal the current literals (foss must not change)", () => {
  const t = loadTokens("android");
  expect(t.color.ground).toBe("#050508");
  expect(t.color.textPrimary).toBe("#d9c9a8");
  expect(t.color.textSecondary).toBe("#c8c0b0");
  expect(t.color.textMuted).toBe("#8a7a5c");
  expect(t.color.label).toBe("#9a875f");
  expect(t.color.accent).toBe("#b3746b");
  expect(t.color.hairline).toBe("#3a3325");
  expect(t.color.surface).toBe("#12100c");
  expect(t.color.surfaceRaised).toBe("#171310");
});

test("ios color values are the polished set (distinct from android)", () => {
  const t = loadTokens("ios");
  expect(t.color.textPrimary).toBe("#f0dcb8");
  expect(t.color.surface).toBe("#0d0b14");
  expect(t.color.hairline).toBe("rgba(240,220,184,0.09)");
  expect(t.ios).toBe(true);
});

test("type tokens are TextStyle-shaped", () => {
  const t = loadTokens("ios");
  expect(typeof t.type.title.fontSize).toBe("number");
  expect(t.type.micro.textTransform).toBe("uppercase");
});
