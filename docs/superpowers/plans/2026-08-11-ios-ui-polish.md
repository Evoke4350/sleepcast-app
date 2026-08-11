# iOS UI Refined-Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an iOS-only visual polish across all five screens via a platform-gated design-token module, leaving Android/foss visually unchanged.

**Architecture:** A single token module (`src/theme/tokens.ts`) exposes color/type/space/radius/surface values; it returns polished values on iOS and the exact current literals on Android (`Platform.OS` gate). Every screen's `StyleSheet` reads tokens instead of ad-hoc hex. Screen changes are refactors that preserve behavior (existing tests stay green); the only new unit test guards the Android values.

**Tech Stack:** React Native 0.86 (TypeScript), `StyleSheet`, `Platform`, `AccessibilityInfo`; Jest + `react-test-renderer`. No new dependencies.

## Global Constraints

- **iOS-only divergence — per-screen branch.** Each screen selects its stylesheet by platform: `const s = t.ios ? iosStyles : androidStyles`, where **`androidStyles` is a verbatim copy of that screen's current `StyleSheet.create` block** (byte-identical → Android/foss frozen, protecting the in-review F-Droid build) and **`iosStyles` is the tokenized/polished version** (free to diverge; not shackled to Android's pixel values). The per-screen "tokenized StyleSheet" shown in Tasks 2–4 is the **iOS branch**. Get the exact current styles from `git show <pre-task-commit>:src/screens/<Screen>.tsx`.
- **No new dependencies. No bundled fonts. No native changes.** SF system font only.
- **No behavior changes.** Presentation only; all 151 existing tests stay green; `tsc --noEmit` + eslint clean.
- **No background/gradient library.** Ground is solid `#050508`; depth comes from surfaces + shadow.
- Branch: `ios-ui-polish`. Commit after each task.

---

### Task 1: Design-token module

**Files:**
- Create: `src/theme/tokens.ts`
- Test: `src/theme/tokens.test.ts`

**Interfaces:**
- Produces: `t` (default export) with:
  - `t.color`: `{ ground, surface, surfaceRaised, hairline, textPrimary, textSecondary, textMuted, label, accent, focusRing }` → all `string`.
  - `t.type`: `{ display, title, heading, body, bodySm, label, micro }` → each a `TextStyle` (`fontSize`, `fontWeight`, `letterSpacing`, and for `micro` `textTransform:"uppercase"`). Plus `t.tabular` → `{ fontVariant: ["tabular-nums"] }`.
  - `t.space(n: number): number` → `n * 4`.
  - `t.radius`: `{ sm: 12, md: 16, pill: 999 }`.
  - `t.surface.panel`: a `ViewStyle` (bg, radius, 1px hairline border, padding, iOS shadow).
  - `t.ios`: `boolean` (`Platform.OS === "ios"`).

- [ ] **Step 1: Write the failing test**

```ts
// src/theme/tokens.test.ts
// Load the module under a forced Platform.OS so we can assert BOTH branches
// regardless of what the RN jest preset defaults to.
function loadTokens(os: "ios" | "android") {
  let t: typeof import("./tokens").default;
  jest.isolateModules(() => {
    jest.doMock("react-native", () => {
      const RN = jest.requireActual("react-native");
      return { ...RN, Platform: { ...RN.Platform, OS: os } };
    });
    t = require("./tokens").default;
  });
  jest.dontMock("react-native");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/theme/tokens.test.ts`
Expected: FAIL — `Cannot find module './tokens'`.

- [ ] **Step 3: Implement the token module**

```ts
// src/theme/tokens.ts
import { Platform, type TextStyle, type ViewStyle } from "react-native";

const ios = Platform.OS === "ios";

// pick(iosValue, androidValue): iOS gets the polished value; Android keeps today's.
const p = <T,>(iosV: T, androidV: T): T => (ios ? iosV : androidV);

const color = {
  ground: "#050508",
  surface: p("#0d0b14", "#12100c"),
  surfaceRaised: p("#14111d", "#171310"),
  hairline: p("rgba(240,220,184,0.09)", "#3a3325"),
  textPrimary: p("#f0dcb8", "#d9c9a8"),
  textSecondary: p("#b0a898", "#c8c0b0"),
  textMuted: p("#6f6a62", "#8a7a5c"),
  label: "#9a875f",
  accent: "#b3746b",
  focusRing: "rgba(240,220,184,0.5)",
};

const type: Record<string, TextStyle> = {
  display: { fontSize: p(34, 40), fontWeight: "600", letterSpacing: -0.4 },
  title: { fontSize: 22, fontWeight: "600", letterSpacing: -0.2 },
  heading: { fontSize: 17, fontWeight: "500" },
  body: { fontSize: 16, fontWeight: "400" },
  bodySm: { fontSize: 15, fontWeight: "400" },
  label: { fontSize: 13, fontWeight: "500", letterSpacing: 0.2 },
  micro: { fontSize: 11, fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase" },
};

const tabular: TextStyle = { fontVariant: ["tabular-nums"] };

const radius = { sm: 12, md: 16, pill: 999 };

const space = (n: number): number => n * 4;

const panel: ViewStyle = {
  backgroundColor: color.surface,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: color.hairline,
  padding: space(4),
  ...(ios
    ? { shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }
    : null),
};

const t = { ios, color, type, tabular, radius, space, surface: { panel } };
export default t;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/theme/tokens.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/theme/tokens.ts src/theme/tokens.test.ts
git commit -m "Add iOS-gated design-token module"
```

---

### Task 2: SetupScreen → tokens + polish

**Files:**
- Modify: `src/screens/SetupScreen.tsx` (its `StyleSheet.create` block near the bottom; import `t`)
- Test (existing, must stay green): `src/screens/SetupScreen.test.tsx`, `src/screens/SetupScreen.youtube-gate.test.tsx`

**Interfaces:**
- Consumes: `t` from `../theme/tokens`.
- Produces: no exported API change. Same `testID`s, same props, same behavior.

This is a refactor: replace the literal styles with tokens and apply the refined spacing/type. The existing tests (testIDs, a11y labels, behavior) are the safety net — they must keep passing unchanged.

- [ ] **Step 1: Run existing SetupScreen tests to confirm the baseline is green**

Run: `npx jest src/screens/SetupScreen`
Expected: PASS (all).

- [ ] **Step 2: Import tokens + rewrite the StyleSheet**

At the top of `SetupScreen.tsx` add: `import t from "../theme/tokens";`

Replace the `const s = StyleSheet.create({...})` block with (mapping literals → tokens, applying `space`, `type`, `surface.panel`; keep every style *name* the JSX already references):

```ts
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.color.ground },
  body: { padding: t.space(6), gap: t.space(3) },
  banner: { alignSelf: "stretch", ...t.surface.panel, paddingHorizontal: t.space(4), paddingVertical: t.space(3), gap: t.space(1) },
  bannerLabel: { color: t.color.label, ...t.type.micro },
  bannerTitle: { color: t.color.textPrimary, ...t.type.bodySm },
  bannerTime: { color: t.color.label, ...t.type.label, ...t.tabular },
  h: { color: t.color.label, ...t.type.micro, marginTop: t.space(3) },
  feedRowContainer: { flexDirection: "column", gap: t.space(1.5) },
  feedRow: { flexDirection: "row", alignItems: "center", gap: t.space(2.5) },
  feedTitle: { color: t.color.textSecondary, flex: 1, ...t.type.bodySm },
  remove: { color: t.color.accent, fontSize: 16, paddingHorizontal: t.space(1.5) },
  trimRow: { flexDirection: "row", alignItems: "center", gap: t.space(2.5) },
  trimBtn: { borderWidth: 1, borderColor: t.color.hairline, borderRadius: t.radius.pill, minWidth: 30, minHeight: 30, alignItems: "center", justifyContent: "center" },
  trimBtnT: { color: t.color.textPrimary, fontSize: 16 },
  trimVal: { color: t.color.textMuted, ...t.type.label, ...t.tabular, minWidth: 44, textAlign: "center" },
  addRow: { flexDirection: "row", gap: t.space(2), alignItems: "center" },
  input: { flex: 1, color: t.color.textPrimary, borderWidth: 1, borderColor: t.color.hairline, borderRadius: t.radius.sm, paddingHorizontal: t.space(3), paddingVertical: t.space(2), ...t.type.body },
  feedError: { color: t.color.accent, ...t.type.label },
  mixWarning: { color: t.color.accent, ...t.type.label, marginBottom: t.space(1) },
  row: { flexDirection: "row", gap: t.space(2.5), flexWrap: "wrap" },
  qhRow: { flexDirection: "row", alignItems: "center", gap: t.space(2.5) },
  qhLabel: { color: t.color.textSecondary, flex: 1, ...t.type.label },
  chip: { borderWidth: 1, borderColor: t.color.hairline, borderRadius: t.radius.pill, paddingHorizontal: t.space(3.5), paddingVertical: t.space(2) },
  chipOn: { borderColor: t.color.textPrimary, backgroundColor: t.ios ? t.color.surfaceRaised : undefined },
  btn: { borderWidth: 1, borderColor: t.color.hairline, borderRadius: t.radius.pill, paddingHorizontal: t.space(4.5), paddingVertical: t.space(2.5) },
  btnT: { color: t.color.textPrimary, ...t.type.label },
  nightsLink: { marginTop: t.space(3) },
  nightsText: { color: t.color.label, ...t.type.label },
  stepback: { alignSelf: "stretch", ...t.surface.panel },
  sbTitle: { color: t.color.textPrimary, ...t.type.bodySm },
  sbBody: { color: t.color.textMuted, ...t.type.label },
});
```

Note: `t.space(1.5)` = 6, `t.space(2.5)` = 10, `t.space(3.5)` = 14, `t.space(4.5)` = 18 — matches the current pixel values so Android is unchanged.

- [ ] **Step 3: Run the SetupScreen tests + typecheck**

Run: `npx jest src/screens/SetupScreen && npx tsc --noEmit`
Expected: PASS, no type errors. (If a test references a color/size that moved, the test asserts behavior/testIDs, not hex — it should not need changes.)

- [ ] **Step 4: Commit**

```bash
git add src/screens/SetupScreen.tsx
git commit -m "Refactor SetupScreen styles onto design tokens"
```

---

### Task 3: PlayerScreen → tokens + polish

**Files:**
- Modify: `src/screens/PlayerScreen.tsx`
- Test (existing, must stay green): any `PlayerScreen`/`App.night` tests that render it.

**Interfaces:**
- Consumes: `t` from `../theme/tokens`.
- Produces: same props/testIDs (`player-root`, `nowPlaying`, `countdown`, `volume`). Behavior unchanged.

- [ ] **Step 1: Run existing tests that render PlayerScreen**

Run: `npx jest PlayerScreen __tests__/App.night.test.tsx`
Expected: PASS (baseline).

- [ ] **Step 2: Import tokens, refine the now-playing block + control row**

Add `import t from "../theme/tokens";`. Update the styles: title → `t.type.display`, countdown → `t.type.title` + `t.tabular`, the `vol 0.xx` line → keep the `testID="volume"` element (tests assert its `accessibilityLabel`) but style it as `t.type.micro` in `t.color.textMuted` so it reads as a quiet caption rather than debug text. Rewrite `s` (the `StyleSheet.create` at the bottom of the file):

```ts
const s = StyleSheet.create({
  body: { flex: 1, backgroundColor: t.color.ground, padding: t.space(6), alignItems: "center", justifyContent: "center", gap: t.space(3) },
  moon: { color: t.color.textPrimary, fontSize: 34, opacity: 0.9 },
  title: { color: t.color.textPrimary, textAlign: "center", ...t.type.display },
  dim: { color: t.color.textMuted, ...t.type.label, ...t.tabular },
  controls: { flexDirection: "row", gap: t.space(3), marginTop: t.space(2), flexWrap: "wrap", justifyContent: "center" },
});
```

Keep the JSX structure; if the countdown currently uses `s.dim`, give it its own `countdown` style: add `countdown: { color: t.color.textSecondary, ...t.type.title, ...t.tabular }` and point the `testID="countdown"` Text at `s.countdown`. Ensure control touchables retain ≥44pt hit area (min padding `t.space(2.5)`).

- [ ] **Step 3: Read the current PlayerScreen JSX (lines 40–107) and apply the styles**

Map each element to the tokenized styles above; do not change any `testID`, `accessibilityRole`, or `accessibilityLabel`. The lineup rows (if `showList`) mark the current pick with `t.color.accent`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx jest PlayerScreen __tests__/App.night.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/screens/PlayerScreen.tsx
git commit -m "Refactor PlayerScreen styles onto design tokens"
```

---

### Task 4: Secondary screens → tokens (Rest, GettingUp, YouTubeNight)

**Files:**
- Modify: `src/screens/RestScreen.tsx`, `src/screens/GettingUpScreen.tsx`, `src/screens/YouTubeNightScreen.tsx`
- Test (existing, must stay green): `RestScreen.test.tsx`, `YouTubeNightScreen.test.tsx`, any GettingUp render tests.

**Interfaces:**
- Consumes: `t` from `../theme/tokens`.
- Produces: no API/testID/behavior change.

Mechanical token application, same recipe as Tasks 2–3: `import t from "../theme/tokens";`, then replace literal hex/sizes in each file's `StyleSheet.create` with the matching token (`#050508`→`t.color.ground`; near-cream text→`t.color.textPrimary`/`textSecondary`; `#8a7a5c`→`t.color.textMuted`; `#9a875f`→`t.color.label`; `#b3746b`→`t.color.accent`; `#3a3325`/`#6f6a62`→`t.color.hairline`; `#12100c`/`#171310`→`t.color.surface`; card blocks→`...t.surface.panel`; paddings/gaps→`t.space(n)`; font sizes→nearest `t.type.*`). Preserve every style name the JSX references and every `testID`.

- [ ] **Step 1: Baseline tests green**

Run: `npx jest RestScreen YouTubeNightScreen GettingUp`
Expected: PASS.

- [ ] **Step 2: Tokenize RestScreen.tsx** — apply the mapping above to its `StyleSheet`.
- [ ] **Step 3: Tokenize GettingUpScreen.tsx** — same.
- [ ] **Step 4: Tokenize YouTubeNightScreen.tsx** — same.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx jest && npx tsc --noEmit`
Expected: full suite PASS (154+ tests incl. the token test), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/screens/RestScreen.tsx src/screens/GettingUpScreen.tsx src/screens/YouTubeNightScreen.tsx
git commit -m "Refactor secondary screens onto design tokens"
```

---

### Task 5: Motion (reduce-motion-aware press feedback) + device verification

**Files:**
- Modify: touchables across the 5 screens to use `activeOpacity={0.6}` where they use `TouchableOpacity` (most already do).
- Optional create: `src/theme/useReduceMotion.ts` — a hook wrapping `AccessibilityInfo.isReduceMotionEnabled()` + the `reduceMotionChanged` listener, returning a boolean. Only add if a transition is introduced; the polish uses opacity press states which are safe without it, so **do not add animation that needs disabling** unless a specific transition is added.

**Interfaces:**
- Consumes: `t`.
- Produces: none.

- [ ] **Step 1:** Ensure every `TouchableOpacity` uses `activeOpacity={0.6}` for consistent press feedback (grep: `rg "TouchableOpacity" src/screens`). No new animations (bedtime = calm), so no Reduce-Motion wiring needed.

- [ ] **Step 2: Full suite + typecheck + lint**

Run: `npx jest && npx tsc --noEmit && npx eslint . --max-warnings=0`
Expected: all green.

- [ ] **Step 3: Device build + eyeball (manual)**

```bash
cd ios && xcodebuild -workspace SleepcastApp.xcworkspace -scheme SleepcastApp -configuration Release \
  -destination 'id=DAE80CF8-2419-59D0-9A65-7E4EE4B8129B' -allowProvisioningUpdates -derivedDataPath build_device clean build
xcrun devicectl device install app --device DAE80CF8-2419-59D0-9A65-7E4EE4B8129B build_device/Build/Products/Release-iphoneos/SleepcastApp.app
```
Then open each screen on the iPhone; confirm the refined look and that nothing is broken. Confirm Android unchanged (run the app in an Android emulator or trust the token test guard).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Consistent press feedback; iOS UI polish complete"
```

---

## Self-Review

**Spec coverage:** token module (Task 1) ✓; iOS-gated Android-unchanged guarantee (Task 1 test) ✓; SF type scale (Task 1 `type`) ✓; per-screen polish Setup/Player (Tasks 2–3) + Rest/GettingUp/YouTube (Task 4) ✓; solid ground/no gradient (Task 1) ✓; restrained motion + reduce-motion (Task 5) ✓; testing incl. Android regression guard (Task 1) + suite green (Tasks 2–5) ✓; no new deps ✓.

**Placeholder scan:** none — all steps carry concrete code or exact commands.

**Type consistency:** `t.color.*`, `t.type.*`, `t.space()`, `t.radius.*`, `t.surface.panel`, `t.tabular`, `t.ios` used consistently across Tasks 2–5 exactly as defined in Task 1.
