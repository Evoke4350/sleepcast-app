# Slice 3 — Sleep Detector (observational)

**Status:** design 2026-08-05. Third parity slice. Not yet built.

Ports sleepcast.pro's sleep detector: while a night plays, it notices when you fell asleep, records the night to a local ledger, and shows you a small history — with a self-label ("did you fall asleep?") that calibrates the detector over time. It is **observational**: it never shortens a night. The slice-2 timer still governs when playback ends.

## What the detector is (and isn't)

The `rest/` engine is a sequential probability test (`SleepDetector`): evidence accumulates while you are quiet and resets when you interact. Its verdict is **gated on the timer fade** (`fadingOrDone`) — it says nothing mid-night and only decides, around the fade, whether you were asleep and when you went under. So:

- It **does not** end the night early. The night ends via the slice-2 native timer (faded) or a manual stop (abandoned).
- Its output is a `RestNight` in the ledger: `sleptAtMs` (onset), `interactions`, `endedVia`, etc. — feeding history, stats, and calibration.
- It observes from JS. When the app is **backgrounded / the screen locks, JS suspends**, so it cannot tick; that night still logs, but with `detector: "none"` and no onset. This is a **foreground / screen-on** feature that degrades gracefully — consistent with the engine's own gated model (`docs/gated-model.md` in the player repo).

## Reuse — the whole engine, unchanged

Every `rest/` module is consumed as-is (the MMKV `localStorage` shim already backs the ledger keys `sleepcast2.rest.*`): `RestSession`, `SleepDetector`, `ledger` (`loadNights`/`appendNight`/`setSelfLabel`/`rollup`/`loadParams`/`saveParams`), `calibrate` (`paramsFromHistory`/`tightenAfterFalsePositive`), `surface` (`fmtDuration`/`lastNight`), `types`. Plus `plays` (`playsSince`/`playAtMoment`) and `getPlays` for the last-night episode list. **No `vendor/player` edits.** The web `RestView` component is React-DOM and is **not** reused; a native screen is written against the same lib, exactly as slices 1–2 did.

## Night integration (`App.tsx`)

`RestSession` is a live JS object tied to a night:

- **Start** (`beginPlayback`): `restRef.current = new RestSession(Date.now(), minutes)`.
- **Interact:** any touch on the player surface calls `restRef.current?.noteInteraction()`. The web counts transport touches (pause/next/scrub); our player exposes only "stop", so the RN adaptation is: **any touch on `PlayerScreen` is a wakefulness signal** — captured with a `PanResponder`/responder-capture that observes without consuming the touch. This is the honest analogue: a tap means you're awake.
- **Tick:** the existing 1s foreground interval also calls `restRef.current?.tick({ now: Date.now(), hidden: appStateRef.current !== "active", fadingOrDone: remaining <= FADE_SECONDS })`. `remaining` is the timer countdown App already computes; `hidden` comes from an `AppState` subscription. (When backgrounded the interval doesn't fire — the detector simply gets fewer observations.)
- **Finish:** wherever a night ends — `onNightEnded` (→ `"faded"`), manual stop (→ `"abandoned"`) — `appendNight(restRef.current.finish(endedVia, Date.now()))`, then clear `restRef`. This slots into the existing `finishNight` funnel.
- **Killed night (reconcile-on-launch):** the `RestSession` object doesn't survive a process kill, so `reconcileToLastNight` appends a minimal `RestNight` from the live marker (`detector: "none"`, `sleptAtMs: null`, `interactions: 0`, `endedVia: "faded"`) so history isn't missing the night. Best-effort; no onset for a night nobody could observe.

`AppState` also updates `appStateRef` so `hidden` is current each tick.

## RestScreen (native port of `RestView`)

A new `src/screens/RestScreen.tsx`, reachable from `SetupScreen` via a small "nights" affordance (a text link under the feed/timer sections). It reads the lib directly and shows:

- `rollup(loadNights())` → nights-you-drifted-off count, fastest and usual time-to-sleep (`fmtDuration`, filtered by `MIN_PLAUSIBLE_ONSET_MS`).
- Last night's episodes from `playsSince(getPlays(), last.startedAt)`, with a "you drifted off here" marker on the episode at `playAtMoment(lastPlays, last.startedAt + last.sleptAtMs)`.
- **Self-label calibration:** when `last.sleptAtMs !== null` and `last.selfLabel === undefined`, prompt "did you fall asleep to it? yes / no". `yes` → `setSelfLabel(startedAt, "slept")`; `no` → `setSelfLabel(startedAt, "awake")` **and**, since a "no" on a night the detector scored is a confirmed false positive, `saveParams(tightenAfterFalsePositive(loadParams()!))` — tightening the detector for next time. This is the whole calibration loop.
- The "counted only on this device, nothing sent anywhere" note.

`testID`s: `rest-nights`, `rest-best`, `rest-median`, `rest-label-yes`, `rest-label-no`, `rest-back`, `open-rest` (the SetupScreen link).

## Testing

- Engine tests already green in `vendor/player` (`rest/*.test.ts`, incl. the detector simulation) — unchanged.
- **New RN tests:**
  - App rest-wiring: starting a night constructs a `RestSession`; the interval `tick` is fed `hidden` (from a mocked AppState) and `fadingOrDone` (true once `remaining <= FADE_SECONDS`); `onNightEnded`/stop calls `appendNight` with the finished night (assert `loadNights()` grew, `endedVia` correct).
  - Interaction: a touch on `PlayerScreen` calls `noteInteraction` (assert the night's `interactions` increments / the responder-capture fires).
  - `RestScreen`: renders `rollup` stats from seeded `loadNights`; the self-label `no` path calls `setSelfLabel("awake")` and `tightenAfterFalsePositive` (assert `saveParams` written with tightened params); `yes` path labels "slept".
  - Reconcile appends a `detector:"none"` night.

## Scope

- **In:** the observational detector wired into the night, the rest ledger, `RestScreen` (history + stats + last-night episodes), and self-label calibration. All pure-TS/OTA — no native module.
- **Out (later / never):** the opt-in quarter-hour rule, step-back nudges, the goodbye/surface moments, the drift game, HR/actigraphy (Phase 2), and observing while backgrounded/locked (that would need native/foreground work; v1 logs `"none"` there). Native lock-screen transport taps as interactions are also out — only in-app touches count for now.

## Done means

Play a night with the app foreground: touching the screen registers as wakefulness, letting the timer fade untouched lets the detector record an onset, and the night appears in `RestScreen` with a time-to-sleep. Answering "no" to "did you fall asleep?" tightens the detector (params change). Everything stays on device.
