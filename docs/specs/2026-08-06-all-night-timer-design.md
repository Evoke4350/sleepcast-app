# Slice 11 — "All night" timer (auto-advance, no stop)

**Status:** design 2026-08-06. Adds an **all night** option beside 5m/45m/60m: no sleep timer, and when an episode ends it auto-advances through the lineup (looping) so audio continues until the listener stops (or the get-up nudge fires). Needs one small native addition (a natural "track ended" signal); the rest is JS. Both flavors, both platforms. Not yet built.

## Why

Today every night has a fade/stop timer (`TIMERS = [5, 45, 60]`) and plays a single lead episode. There's no "keep playing all night" option, and even a timed night goes silent if its episode ends before the timer. The listener wants continuous audio through the night. "All night" = no timer + auto-advance.

## Key facts this builds on

- `beginPlayback(lead, minutes)` sets `endAtRef = now + minutes*60_000` and calls `scheduleFadeAndStop`. The 1 s tick reads `endAtRef` for the countdown/volume and drives the rest detector + quarter-hour rule; it **bails immediately when `endAtRef === null`** (today that never happens).
- The lineup (8 picks) already exists in `lineupRef`; slice 9's `skipTo(ep)`/`skipToNext()` switch episodes, and `skipToNext` uses the vendor `nextPlayable`.
- Native has **no** natural-completion signal — only the timer-driven `onNightEnded`. ExoPlayer reaches `STATE_ENDED` / AVPlayer posts `AVPlayerItemDidPlayToEndTime` when a track finishes, but nothing forwards that to JS.

## Design

### The sentinel

`ALL_NIGHT = -1` (a `Strategy`-independent timer sentinel, valid JSON, never a real minute count). `TIMERS = [5, 45, 60, ALL_NIGHT]`. Persisted via the existing `saveTimerMinutes`/`timerMinutes` as `-1`.

### Native (both platforms) — one new event

Add a codegen event `readonly onTrackEnded: EventEmitter<TrackEndedEvent>` (`{ episodeId: string }`) to `src/specs/NativeNightAudio.ts`, distinct from `onNightEnded` (timer fade).

- **Android (`NightAudioModule.kt`):** register a `Player.Listener`; on `onPlaybackStateChanged(STATE_ENDED)` emit `onTrackEnded(currentEpisodeId)`. Track the current episode id (already have `timerEpisodeId`; add a `currentEpisodeId` set in `play`/schedule).
- **iOS (`NightAudioImpl.swift`):** observe `AVPlayerItemDidPlayToEndTime` for the current item → emit `onTrackEnded(currentEpisodeId)`.
- Fires on **natural completion only** — the timer-fade path (`onNightEnded`) is unchanged. Emitted for every night; JS decides what to do with it.

### JS — `skipTo` becomes timer-aware (the unifying change)

`skipTo(ep)` currently guards `if (end === null) return` and always re-arms `scheduleFadeAndStop(ep.id, remaining, …)`. Change: it switches the episode regardless, and **schedules a fade only when the night is timed** (`endAtRef.current !== null`). So:

- The guard becomes `if (!cur || ep.id === cur.id) return;` (drop the `end === null` bail) — plus the existing `skippingRef`/`cancelTimer()`.
- Compute+schedule the fade only inside `if (endAtRef.current !== null)`. For all-night, no timer is armed.
- Marker: timed night as slice 9; **all-night** writes `timerMinutes`/`nightMinutes` as a large sentinel (`ALL_NIGHT_CAP_MIN = 600`) so `reconcileToLastNight`'s heard cap is effectively "elapsed since this episode started" and a killed all-night reconciles the current episode.

`skipToNext()` is unchanged (it calls `skipTo`). **Manual jump/next now work in all-night** for free.

### JS — `App.tsx`

- **`beginPlayback(lead, minutes)`:** if `minutes === ALL_NIGHT` → `endAtRef.current = null`, **do not** call `scheduleFadeAndStop`, set `setVolume(trim)` once (full, no fade); else the existing timed path. `restRef`/`quarterHourRef`/`nightStartedAtRef` are set the same way (all-night still observes rest + honors the quarter-hour rule — the one thing that can end an all-night session besides stop).
- **The tick:** restructure the `end === null` branch to *not* bail for a live all-night night. When `nowRef.current` is set and `endAtRef.current === null`: run `restRef.current?.tick({ now, hidden, fadingOrDone: false })` and the quarter-hour check (elapsed from `nightStartedAtRef`), but skip the countdown/volume math. (When there is genuinely no night — `nowRef.current === null` — still bail.)
- **New `onTrackEnded(episodeId)` handler** (subscribed next to `onNightEnded` in the mount effect): if there's a live night AND it's all-night (`endAtRef.current === null`), call `skipToNext()` to advance (loops the lineup via `nextPlayable`). If it's a timed night, ignore (preserve today's behavior — the timer owns the ending). Guard against acting when no night is live.
- **The `remaining`/display:** for all-night, `remaining` isn't meaningful. Pass an `allNight` flag to `PlayerScreen`/the banner so they render **"all night"** instead of a countdown.

### JS — `SetupScreen`

- `TIMERS` includes `ALL_NIGHT`; the chip renders `all night` (testID `timer-all-night`), selected-state like the others, `accessibilityLabel="all night timer, plays until you stop"`. Selecting persists `-1`.
- The now-playing banner: when `allNight`, show `♪ now playing` + title + `all night` (no countdown).

### JS — `PlayerScreen`

- New optional `allNight?: boolean`. When true, the countdown line renders `all night` (still `testID="countdown"`, `accessibilityLabel="playing all night"`), and the volume line is unchanged.

## Testing

- **`skipTo` timer-aware (App):** in a timed night, skip still re-arms `scheduleFadeAndStop` (slice-9 test stays green). In an all-night night (started with `ALL_NIGHT`), a skip switches the episode and `play` is called but `scheduleFadeAndStop` is **not**.
- **Auto-advance (App):** start an all-night night; fire the mocked `onTrackEnded` for the current episode → `play` is called for a different lineup episode, no `scheduleFadeAndStop`; firing it again keeps advancing. In a **timed** night, firing `onTrackEnded` does nothing (`play` count unchanged).
- **beginPlayback all-night:** starting with `ALL_NIGHT` calls `play` but not `scheduleFadeAndStop`; `endAtRef` is null (the tick doesn't crash and the rest/quarter-hour still run — assert `restRef` tick observed / quarter-hour can still fire).
- **`SetupScreen`:** the `all night` chip renders, selects, and persists `timerMinutes === -1`; the banner shows `all night` when `allNight`.
- **`PlayerScreen`:** with `allNight`, the countdown shows `all night`; without, a formatted time (existing tests green).
- **Native:** no unit host; verified on device.
- **On-device (Pixel, foss):** pick **all night**, start → plays; let an episode end (or use a short test clip) → auto-advances to the next pick with no gap and no stop; the player shows `all night`; **home**/banner still work and show `all night`; manual **next**/tap-a-pick still switch; **stop** ends it; with the get-up nudge on, a restless spell still ends the night.

## Scope

- **In:** the `all night` chip + sentinel, the native `onTrackEnded` event (both platforms + codegen), the timer-aware `skipTo`, the all-night `beginPlayback`/tick/auto-advance path, the `all night` display on player + banner, tests, device check.
- **Out:** auto-advancing a **timed** night when its episode ends early (kept as-is to not change timed behavior — a possible later win); gapless/crossfade between episodes (there's a brief load gap on advance, acceptable for sleep); a per-episode "played history" beyond the existing `playedIds`; iOS device verification (needs the Xcode signing team — code mirrors the device-proven Android path, same standing follow-up as prior slices).

## Done means

Selecting **all night** starts a night with no fade/stop; when each episode ends it auto-advances through the lineup (looping) so audio continues until the listener presses **stop** (or the get-up nudge fires). The player and the now-playing banner read **all night** instead of a countdown; home, manual next, and jump-to-pick all work. Timed nights (5/45/60) are unchanged. Both flavors; the only native change is a natural-completion event.
