# Slice 7 — Accessibility Pass

**Status:** design 2026-08-06. Makes the app usable with a screen reader (TalkBack/VoiceOver) and improves low-vision contrast. Pure-TS/RN, OTA. Not yet built.

Today every screen has `testID`s but **zero** accessibility props — a screen-reader user can hit the text buttons but can't tell feeds apart, read the volume trims, or operate the steppers/toggles. This adds `accessibilityRole`/`Label`/`State`/`Value`/`Hint` to every control, hides decorative elements from the reader, announces errors/alerts, and nudges the two failing-contrast text colors to ~4.5:1.

## Principles (applied per screen)

- **Every interactive control** gets an explicit `accessibilityRole` (`button` / `switch` / `adjustable` / `link` / `header`) and an `accessibilityLabel` that names what it does *and what it acts on* (e.g. "increase volume for Sleep With Me", not "plus").
- **Steppers** (`−`/`+` trim) → the value display is `accessibilityRole="adjustable"` with `accessibilityValue={{ text: "1.00×" }}` and `onAccessibilityAction` for increment/decrement; the `−`/`+` buttons get labels ("quieter"/"louder" for `<feed>").
- **Switches** (feed toggles, get-up nudge) → `accessibilityLabel` naming the feed/setting; RN gives `switch` role + on/off state automatically, but the label must carry the name.
- **Selected state** → timer chips get `accessibilityRole="button"` + `accessibilityState={{ selected: minutes===m }}`.
- **Decorative** elements (the `☾` moon, the YouTube thumbnail overlay chrome) → `accessibilityElementsHidden`/`importantForAccessibility="no-hide-descendants"` so the reader skips them.
- **Live regions** → the feed error, the mix-warning, and the getting-up screen announce via `accessibilityLiveRegion="polite"` (Android) + `accessibilityRole="alert"`; the getting-up title is a `header`.
- **Dynamic values** (countdown, volume) → labelled with human text ("4 minutes 55 seconds remaining", "volume 50 percent") rather than raw "4:55"/"0.50", and marked `accessibilityLiveRegion="polite"` only where it won't spam (the countdown updates every second — do NOT make it a live region; give it a static label and let the user query it).
- Font scaling stays enabled (already is); no fixed-height control may clip a label — the trim `−`/`+` boxes get `minWidth`/`minHeight` instead of fixed `width`/`height`.

## Per-screen work

- **SetupScreen** — feed rows: toggle Switch (`accessibilityLabel="<feed> feed"`), remove `✕` (`button`, "remove <feed>"), trim stepper (adjustable value + quieter/louder buttons). Add-feed `TextInput` (`accessibilityLabel="feed URL"`) + add `button`; OPML import/export `button`s; the `feed-error` alert/live-region. Timer chips (`button` + selected state, label "<n> minute timer"). Get-up-nudge Switch (label). Start buttons (`button`, "start shuffle/spread/varied", resume). `mix-warning` alert/live-region. Step-back offer: the two buttons labelled ("go quiet"/"not now"), the card text readable. `nights ›` link (`link`/`button`, "sleep history").
- **PlayerScreen** — `☾` decorative-hidden; title `header`; countdown labelled ("N minutes remaining"); volume labelled ("volume P percent"); `stop` `button`. The responder-capture wrapper must not swallow accessibility focus (leave the children individually focusable).
- **RestScreen** — the big stat number + caption combined into one labelled element per stat ("3 nights you drifted off"); the yes/no self-label `button`s ("yes, I fell asleep" / "no, I stayed awake"); `back` `button`/`link`; the last-night episode rows labelled with title + minutes + "you drifted off here" where present.
- **GettingUpScreen** — title `header`, body readable, `ok` `button`; the screen announces on mount (live region / `accessibilityAutoFocus` on the title).
- **YouTubeNightScreen** — title `header`; countdown/volume labelled; `stop`/`tap-to-begin` `button`s (tap-to-begin: "start playback"); the `screen stays on for YouTube` note readable; the WebView player is left as-is (the embed carries its own a11y).

## Contrast

Two text colors fail WCAG AA on `#050508`: `#6e5d44` (~2.7:1, used for dim/interactive text incl. the nights link and captions) and `#4a4540` (~2:1, the "counted only on this device" notes). Raise them to meet ~4.5:1 while keeping the warm-dark palette:
- `#6e5d44` → `#9a875f` (interactive/important dim text)
- `#4a4540` → `#6f6a62` (footnotes)
Applied via the per-screen `StyleSheet`s (the colors are inline hex, not a shared token — change each occurrence). Brighter accent/label colors (`#d9c9a8`, `#c8c0b0`, `#b0a898`, `#8a7a5c`) already pass and are unchanged. This is a modest, reversible nudge, not a redesign.

## Testing

- **Per screen**, react-test-renderer assertions: key controls expose the expected `accessibilityRole` + a non-empty `accessibilityLabel` (e.g. a feed toggle's label contains the feed name; a trim value is `accessibilityRole="adjustable"` with an `accessibilityValue`; a selected timer chip has `accessibilityState.selected===true`; the moon is hidden). These sit alongside the existing `testID` tests (testIDs stay for the test suite).
- The existing behavioral tests must stay green (adding a11y props must not change behavior).
- No unit test for contrast (it's a color-value change) — assert the new hex is present in the relevant style if convenient, else rely on review.
- **On-device (Pixel 7):** enable TalkBack, sweep SetupScreen + a night: confirm feeds, trims (value announced), toggles, timers (selected announced), and start buttons are all announced with meaningful names; the moon is skipped; the getting-up/mix-warning announce.

## Scope

- **In:** accessibility props on every control across all five screens (roles, labels, state, value, hints, decorative-hiding, live regions), the two contrast fixes, and a TalkBack on-device sweep.
- **Out:** a full visual redesign; RTL/localization; the WebView embed's internal a11y (Google owns it); haptics; reduce-motion (the only motion is the loading spinner + the volume fade — no gating needed).

## Done means

With TalkBack on, a blind user can navigate SetupScreen and start/stop a night entirely by ear: every feed, trim (with its current ×value), toggle, timer (with selected state), and start control is announced with a meaningful name; errors and the getting-up prompt are spoken; the moon and other decoration are skipped. The two lowest-contrast text colors meet ~4.5:1. No behavior changes.
