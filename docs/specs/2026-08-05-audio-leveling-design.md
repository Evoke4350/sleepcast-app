# Slice 4 — Per-Feed Volume Leveling

**Status:** design 2026-08-05. Fourth parity slice. Not yet built.

Some sleep feeds are mastered far louder than others; a loud show (or a loud ad) after a quiet one jolts you awake. This adds a **per-feed volume trim** (0.5×–1.5×) that rides on top of the fade, so each show plays at a level you set once. It's the tractable half of sleepcast.pro's "leveling"; the Web-Audio auto-compressor (`Leveler`) is deferred (see Out).

## The mechanism (already in the shared lib)

`engine.ts` already has the exact curve:

```ts
effectiveVolume(remaining, fade, trim) = clamp01(fadeVolume(remaining, fade) * trim)
```

And the trim already has a home in settings: `Settings.feedTrim: Record<feedId, number>` (0.5..1.5, absent = 1.0), with `leveler.ts` providing `TRIM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5]` and `nextTrim(current, ±1)` to step between them. So the math and storage are done; this slice is wiring + UI + a small native change.

## Why a native change is needed

Slice 2 moved the fade into the native timer (`scheduleFadeAndStop`), which sets `player.volume = fadeVolume(remaining, fade)` each tick — authoritative, and running when JS is asleep. A JS-only trim would be overwritten by that native fade. So the trim must travel to native and be folded into the same computation. This is the one non-OTA part, and it's small: one extra parameter and one multiply, mirroring the `fadeVolume` port already in Kotlin and Swift.

Note the trim applies the **whole night**, not just the fade: before the fade window `fadeVolume` returns 1, so `effectiveVolume = trim` — a 0.75× feed plays at 0.75 from the start and fades from there.

## Native module change

`scheduleFadeAndStop` gains a `trim`:

```ts
// src/specs/NativeNightAudio.ts
scheduleFadeAndStop(episodeId: string, durationSeconds: number, fadeSeconds: number, trim: number): void;
```

- **Both platforms:** store `trim`; set `player.volume = effectiveVolume(remaining, fade, trim)` each tick, where `effectiveVolume(r, f, t) = clamp01(fadeVolume(r, f) * t)` — port the one-line multiply+clamp beside the existing `fadeVolume` port, pinned by the same parity test (Kotlin JUnit, Swift). On `scheduleFadeAndStop` also set `player.volume = clamp01(trim)` immediately (before the first tick) so a quiet feed doesn't blip to full for a beat.
- `cancelTimer`/`stop` unchanged.

`play()`'s existing `volume = 1` reset (the slice-2 silent-resume fix) stays — the immediate trim set in `scheduleFadeAndStop` (called right after `play`) then applies the feed's level.

## JavaScript

- **App wiring:** when starting a night, pass the current episode's feed trim:
  ```ts
  const trim = loadState().settings.feedTrim[lead.feedId] ?? 1;
  getNightAudio()?.scheduleFadeAndStop(lead.id, minutes * 60, FADE_SECONDS, trim);
  ```
  The JS interval's cosmetic volume readout switches from `fadeVolume(left, …)` to `effectiveVolume(left, …, trim)` (a ref holds the active trim) so the on-screen `vol` matches what's playing.
- **Per-feed trim UI (`SetupScreen`):** each feed row gains a small stepper — `−  1.0×  +` — that reads `settings.feedTrim[feed.id] ?? 1`, moves via `nextTrim`, and persists through `saveState({ ...state, settings: { ...settings, feedTrim: { ...feedTrim, [id]: next } } })`. A trim of exactly 1.0 may be stored or omitted; display always shows the effective value.

## Testing

- `effectiveVolume`, `nextTrim`, `TRIM_STEPS` are already unit-tested in `vendor/player` — unchanged.
- **New RN tests:**
  - Native parity: the Kotlin + Swift `effectiveVolume` port matches the TS at sample points (e.g. `(30, 60, 0.5) → 0.25`, `(120, 60, 0.75) → 0.75`, clamp at `(0,60,1.5) → 0`, `(120,60,2) → 1`).
  - App wiring: starting a night calls `scheduleFadeAndStop` with the current feed's trim (assert the 4th arg for a feed with a set trim vs a default 1).
  - `SetupScreen`: the trim stepper reads/steps/persists — tapping `+` on a feed at 1.0 stores 1.25 (via `nextTrim`) in `settings.feedTrim`, and the display updates.
- **On-device (Pixel 7):** set a built-in feed's trim to 0.5×, start a night on it, confirm it plays audibly quieter than a 1.0× feed (relative check); confirm the trim persists across relaunch.

## Scope

- **In:** per-feed volume trim end to end — the `trim` param on the native timer (both platforms) + `effectiveVolume` port, App passing the current feed's trim, and the per-feed trim stepper on `SetupScreen`.
- **Out (deferred):** the Web-Audio-style **auto-compressor** (`Leveler` / the `leveling` setting) — it needs a native audio-processing graph (ExoPlayer `AudioProcessor` / `AVAudioEngine`), and the web itself disables it on iOS because Web Audio suspends on lock. The **brown-noise** generator (`noise.ts`) is also out (needs native noise playback). Both are their own later slices.

## Done means

On device: a feed you've trimmed to 0.5× plays at half volume for the whole night and still fades to silence at the timer; a 1.0× feed is unchanged; the trim you set survives a relaunch. The native fade continues to work with the screen locked (the trim is inside the same native computation).
