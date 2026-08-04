# Slice 2 — Native Background Timer and Fade

**Status:** design 2026-08-04. Fixes the defect surfaced by slice 1's on-device
verification. Android + iOS. Not yet built.

## The defect

The foreground `NightAudioService` (Android) and the `.playback` audio session
(iOS) keep **audio** alive when the screen locks. But the **sleep timer, the
volume fade, and the stop** are driven by a JavaScript `setInterval` in
`App.tsx`. Android suspends JS timers when the activity backgrounds, and iOS
suspends JS execution on lock unless something keeps the app active — so on a
locked phone the interval stops firing, the fade never runs, and **the audio
plays past the timer, all night** (verified on a Pixel 7: still playing at 4+
minutes on a 1-minute timer).

This defeats the entire reason the app is native. It is pre-existing (the thin
slice drove the fade the same way); slice 1 preserved it. This slice fixes it.

## Design premise

The timer must be **authoritative in native code**, where it keeps running with
the screen off:

- **Android:** the foreground `MediaSessionService` keeps the process and its
  main `Looper` alive; a `Handler` posted there fires regardless of activity
  visibility.
- **iOS:** the `.playback` session + `UIBackgroundModes: audio` keep the app
  active while playing; a `DispatchSourceTimer` on the main queue keeps firing.

JavaScript keeps its `setInterval` **only** for the on-screen countdown while
the app is foregrounded — cosmetic, best-effort. Native owns the fade and the
stop.

This revises the slice-1 doctrine ("the fade stays in shared TS, the native
module is dumb"). That was true on iOS *in theory* and false on Android *in
practice*. The fade **curve** stays the single source of truth — `fadeVolume`
in the shared repo — but its four-line formula is mirrored natively on both
platforms, pinned by a parity check, and the native side drives it.

## The fade curve (ported verbatim, both platforms)

```ts
// vendor/player/src/lib/engine.ts
fadeVolume(remainingSeconds, fadeSeconds):
  remaining >= fade -> 1
  remaining <= 0    -> 0
  else              -> remaining / fadeSeconds
```

Kotlin and Swift each implement exactly this (a linear ramp over the final
`fadeSeconds`), with a unit test asserting parity against the TS values at
sample points (e.g. remaining = fade, fade/2, 1, 0).

## Native module surface changes

`src/specs/NativeNightAudio.ts` (the codegen TurboModule spec) gains:

```ts
/** Start the authoritative sleep timer. Native fades volume over the final
 *  fadeSeconds and stops at durationSeconds, whether or not JS is awake.
 *  Called once, right after play(). */
scheduleFadeAndStop(durationSeconds: number, fadeSeconds: number): void;

/** Cancel the running timer (manual stop, or starting a new night). */
cancelTimer(): void;

/** Fires once when the native timer reaches zero and stops playback.
 *  Delivered to JS whenever the JS thread is reachable (event dispatch is not
 *  gated by the background timer throttle). */
readonly onNightEnded: EventEmitter<NightEndedEvent>;
```

`NightEndedEvent` carries what JS needs to write the ledger without having been
awake: `{ episodeId, heardSeconds }`. (The module already holds the current
item; the played episode id is passed down from JS at `scheduleFadeAndStop`
time and echoed back, so JS need not have kept it in a live closure.)

Revised signature to carry the id:
`scheduleFadeAndStop(episodeId: string, durationSeconds: number, fadeSeconds: number)`.

### Android (`NightAudioModule` / `NightAudioService`)

- A single `Handler(Looper.getMainLooper())` timer. `scheduleFadeAndStop`
  records `endAt = elapsedRealtime() + duration*1000` and posts a ~500 ms tick.
- Each tick: `remaining = (endAt - now)/1000`; `player.volume =
  fadeVolume(remaining, fade)`. When `remaining <= 0`: `player.stop()`, emit
  `onNightEnded`, clear the timer.
- `cancelTimer()` / `stop()` remove the callbacks. Ticks run on the main thread
  (ExoPlayer requires it), which the foreground service keeps alive.
- Uses `elapsedRealtime()` (monotonic, unaffected by wall-clock changes).

### iOS (`NightAudioImpl`)

- A `DispatchSourceTimer` on `DispatchQueue.main`, ~0.5 s repeating.
- Same math: fade `player.volume` and, at zero, `stop()` + emit `onNightEnded`.
- The `.playback` session already keeps the app active while playing, so the
  timer fires with the screen locked.

### Event plumbing

The New-Architecture codegen `EventEmitter` is the sanctioned native→JS path.
`NightAudio.mm` bridges it on iOS; the Android module emits via the generated
emitter. (If codegen event wiring proves heavy, the fallback is the legacy
`RCTDeviceEventEmitter` / `DeviceEventEmitter` — decided at implementation time,
but the codegen path is preferred for a New-Arch TurboModule.)

## JavaScript changes (`App.tsx`)

- **On start (`beginPlayback`):** after `play()`, call
  `getNightAudio()?.scheduleFadeAndStop(lead.id, minutes*60, FADE_SECONDS)`.
  The JS `setInterval` remains, but only updates the countdown/volume UI while
  foregrounded; it no longer calls `endSession` on `left <= 0` (native owns
  that now) — it just stops updating.
- **On native end (`onNightEnded`):** subscribe once; the handler runs the
  existing `endSession` bookkeeping (recordHeardPlay gated on `heardSeconds >=
  HEARD_SEC`, append to playedIds, `saveLastNight`) using the event's
  `episodeId`/`heardSeconds`. This is what makes **resume-after-fade work after
  a locked night**.
- **On manual stop:** `cancelTimer()` then the existing `endSession("abandoned")`.
- **Reconcile-on-launch fallback:** persist a lightweight "live night" marker
  when a night starts (episode id, started-at, timer). On app launch, if the
  marker exists and native reports nothing playing (the process was killed
  overnight before the event could fire), reconcile: write the ledger /
  lastNight from the marker, then clear it. Belt-and-suspenders for the
  process-killed case the event can't cover.

## What stays the same

- `fadeVolume` remains the shared, tested curve; nothing in `vendor/player`
  changes.
- The audio-session / foreground-service lifecycle is untouched — this slice
  adds a timer to the module, it does not restructure playback.
- Selection, feeds, OPML, embeddings, screens — all of slice 1 — are untouched.

## Testing

- **Unit (TS):** `App.tsx` — on `onNightEnded`, `endSession` bookkeeping runs
  (saveLastNight written, heard recorded past threshold); on manual stop,
  `cancelTimer` called; the JS interval no longer writes the ledger on
  `left<=0`. Reconcile-on-launch writes the ledger from a stale live marker when
  native reports not-playing.
- **Native parity (Kotlin + Swift):** `fadeVolume` port matches the TS values at
  sample points.
- **On-device (both):**
  - **Pixel 7 (Android):** start a short timer, **lock the screen**, confirm the
    audio audibly fades and **stops at the timer** (not before, not after), and
    that after unlocking the app offers **resume last night** and resumes.
  - **iPhone 15 Pro Max (iOS):** the same, after `pod install` + a device build.

## Scope and division

- **In:** the native timer/fade/stop and its JS wiring on **both** Android and
  iOS; the `onNightEnded` event; reconcile-on-launch; parity tests; on-device
  verification on both physical phones.
- **Out:** any change to selection/feeds/embeddings; pause/resume timer
  semantics (the app has no pause control — a night runs to its timer or is
  stopped); the 16 KB `.so` alignment and other slice-1 follow-ups.

## Done means

On **both** physical phones: a night started, the screen locked for the full
timer, the last stretch audibly a fade rather than a cut, playback stopping at
the timer, and — after unlocking — the app offering and performing resume of
that night. The locked-screen defect is closed on the platforms the app ships
on.
