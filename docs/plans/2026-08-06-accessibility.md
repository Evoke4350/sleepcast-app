# Accessibility Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every screen usable with a screen reader and fix the two failing-contrast text colors — no behavior change.

**Architecture:** Per-screen labeling pass adding `accessibilityRole`/`Label`/`State`/`Value`/`Hint`, hiding decorative elements, and announcing alerts. Contrast: replace `#6e5d44`→`#9a875f` and `#4a4540`→`#6f6a62` in each screen's `StyleSheet`. Existing `testID`s stay; new tests assert the a11y props.

**Tech Stack:** React Native 0.86, TypeScript, Jest + react-test-renderer.

## Global Constraints

- Never edit `vendor/player/`. Behavior must not change — only add a11y props + swap two hex colors. Existing tests stay green.
- Label pattern: name the action AND its target ("louder — Sleep With Me", not "plus"). Roles: `button` / `switch` / `adjustable` / `link` / `header`. Decorative → `accessibilityElementsHidden={true} importantForAccessibility="no-hide-descendants"`.
- Steppers: the value `Text` is `accessibilityRole="adjustable"` + `accessibilityValue={{ text }}`; the `−`/`+` keep `button` role + labels. Fixed-size boxes (`width:30,height:30`) → `minWidth:30,minHeight:30` so scaled text/labels don't clip.
- Contrast: `#6e5d44`→`#9a875f`, `#4a4540`→`#6f6a62` (every occurrence in the touched screen). Brighter colors unchanged.
- Run tests: `PATH=/opt/homebrew/bin:$PATH npx jest <path>`; typecheck clean. TDD-ish: add the a11y assertions, then the props.

## Task 1: SetupScreen a11y + contrast

**Files:** `src/screens/SetupScreen.tsx`, `src/screens/SetupScreen.test.tsx`.

Controls to label (each keeps its `testID`):
- Feed toggle `Switch` → `accessibilityLabel={`${f.title} feed`}` (RN adds switch role + on/off).
- Remove `✕` → `accessibilityRole="button"`, `accessibilityLabel={`remove ${f.title}`}`.
- Trim stepper: wrap the value `Text` as `accessibilityRole="adjustable"`, `accessibilityValue={{ text: `${trim.toFixed(2)} times` }}`, `onAccessibilityAction` handling `increment`/`decrement` → `stepTrim`; the `−`/`+` `TouchableOpacity` get `accessibilityRole="button"` + labels `` `quieter — ${f.title}` `` / `` `louder — ${f.title}` ``. Change the `trimBtn` style `width/height:30`→`minWidth/minHeight:30`.
- Add-feed `TextInput` → `accessibilityLabel="feed URL"`; add `TouchableOpacity` → `button`, "add feed".
- `feed-error` `Text` → `accessibilityRole="alert"`, `accessibilityLiveRegion="polite"`.
- OPML import/export → `button`, "import OPML file" / "export OPML file".
- Timer chips → `accessibilityRole="button"`, `accessibilityLabel={`${m} minute timer`}`, `accessibilityState={{ selected: minutes===m }}`.
- Get-up-nudge `Switch` → `accessibilityLabel="get-up nudge: stop and suggest getting up after 25 restless minutes"`.
- Start buttons → `button`, "start — shuffle/spread/varied"; resume → "resume last night".
- `mix-warning` → `accessibilityRole="alert"`, `accessibilityLiveRegion="polite"`.
- Step-back card: buttons "go quiet" / "not now" (`button`); the two `Text` lines readable (default).
- `nights ›` → `accessibilityRole="link"`, `accessibilityLabel="sleep history"`.
- Contrast: swap the two colors in this file's `StyleSheet`.

- [ ] **Step 1: Add failing a11y assertions** to `SetupScreen.test.tsx`, e.g.:
```tsx
test("controls expose accessibility labels/roles", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SetupScreen onStart={() => {}} onOpenRest={() => {}} />); });
  const toggle = find(tree, "feed-toggle-swm");
  expect(toggle.props.accessibilityLabel).toMatch(/Sleep With Me/i);
  const up = find(tree, "trim-up-swm");
  expect(up.props.accessibilityRole).toBe("button");
  expect(up.props.accessibilityLabel).toMatch(/louder/i);
  const val = find(tree, "trim-value-swm");
  expect(val.props.accessibilityRole).toBe("adjustable");
  expect(val.props.accessibilityValue?.text).toMatch(/times|×|1\.00/);
  const t5 = find(tree, "timer-5");
  expect(t5.props.accessibilityRole).toBe("button");
  const shuffle = find(tree, "start-shuffle");
  expect(shuffle.props.accessibilityLabel).toMatch(/shuffle/i);
});
```
- [ ] **Step 2:** run (fail) → **Step 3:** apply the labels + contrast → **Step 4:** run (pass) + full suite + tsc → **Step 5:** commit `feat(a11y): label SetupScreen controls and fix contrast`.

## Task 2: PlayerScreen + GettingUpScreen a11y + contrast

**Files:** `src/screens/PlayerScreen.tsx`(+test), `src/screens/GettingUpScreen.tsx`(+test).
- PlayerScreen: `☾` → decorative-hidden; title `Text` → `accessibilityRole="header"`; countdown → `accessibilityLabel={humanTime(remaining)}` (e.g. "4 minutes 55 seconds remaining" — add a tiny local `humanTime(sec)` helper, no vendor edit); volume → `accessibilityLabel={`volume ${Math.round(volume*100)} percent`}`; `stop` → `button`, "stop". Contrast swap.
- GettingUpScreen: title `header` (+ consider `accessibilityAutoFocus`/announce); body readable; `ok` → `button`. The root gets `accessibilityLiveRegion="polite"`. Contrast swap.
- Tests assert: moon hidden, title header, stop/ok `button` with labels, countdown/volume labels non-empty.
- Commit `feat(a11y): label PlayerScreen + GettingUpScreen, fix contrast`.

## Task 3: RestScreen a11y + contrast

**Files:** `src/screens/RestScreen.tsx`(+test).
- Each stat: give the number+caption a combined `accessibilityLabel` on the container (`accessible={true}`) e.g. "3 nights you drifted off", and hide the inner `Text`s from the reader (or leave them — but the combined label reads best). The stat `testID`s (`rest-nights` etc.) stay on their `Text`.
- Self-label buttons → `button`, "yes, I fell asleep to it" / "no, I stayed awake".
- `rest-back` → `button`/`link`, "back".
- Last-night episode rows → `accessible={true}` with a label combining title + minutes + (if drift marker) "you drifted off here".
- Contrast swap.
- Tests: `rest-label-yes`/`no` roles+labels; back label; a stat container has an accessibilityLabel.
- Commit `feat(a11y): label RestScreen, fix contrast`.

## Task 4: YouTubeNightScreen a11y + contrast

**Files:** `src/screens/YouTubeNightScreen.tsx`(+test).
- title `header`; countdown/volume labelled (as PlayerScreen); `yt-stop` → `button` "stop"; `yt-begin` → `button` "start playback"; `yt-screen-note` readable; the WebView left as-is. Contrast swap.
- Tests: `yt-stop`/`yt-begin` roles+labels; title header. (Use the existing injected-fake `createPlayer` setup so no WebView is needed.)
- Commit `feat(a11y): label YouTubeNightScreen, fix contrast`.

## Task 5: On-device TalkBack sweep (Pixel 7)

- [ ] Build + install HEAD. Enable TalkBack (`adb shell settings put secure enabled_accessibility_services com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService` + `accessibility_enabled 1`, or via Settings).
- [ ] Sweep SetupScreen: swipe through — confirm each feed toggle announces its name + on/off, each trim value announces its ×value and is adjustable, timers announce selected, start buttons announce. The moon (start a night) is skipped; countdown/volume announce meaningfully.
- [ ] Confirm the getting-up screen / mix-warning announce. Screenshot the TalkBack focus rects where possible.
- [ ] Disable TalkBack afterward (leave device clean).

---

## Self-Review

**Spec coverage:** every control across the five screens gets a role+label (Tasks 1–4); steppers adjustable+value; selected state on timers; decorative moon hidden; alerts/getting-up as live regions; the two contrast colors swapped everywhere they appear (Tasks 1–4); TalkBack device sweep (Task 5); no behavior change (only props + hex). No `vendor/player` edits.

**Placeholder scan:** the `humanTime(sec)` helper (Task 2) is a small local formatter (e.g. minutes/seconds words) — implementer writes it; not a vendor dep. No other gaps.

**Type/name consistency:** a11y props are standard RN (`accessibilityRole`/`Label`/`State`/`Value`/`Hint`/`accessibilityElementsHidden`/`accessibilityLiveRegion`/`onAccessibilityAction`); `testID`s unchanged; contrast hexes `#9a875f`/`#6f6a62` used consistently.
