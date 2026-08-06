# Slice 9 — Varied-night lineup list + skip

**Status:** design 2026-08-06. Shows the computed lineup on a multi-episode night and lets the listener jump to any pick or advance to the next one, without changing the night's length. Pure-TS/RN, no native changes, both flavors. Not yet built.

## Why

A `varied` or `spread` night already computes an 8-episode lineup (`chooseLineup` → `lineupRef`), but `PlayerScreen` shows only the single lead episode playing under a native fade/stop, and the other seven picks are invisible and unreachable (used only for resume/next-night). This adds: (1) the lineup shown as a list, (2) tap a pick to switch to it, (3) a **next** button to advance. `shuffle` (a single-episode lineup) is unchanged.

## Key facts this builds on

- **The picks already exist** in `lineupRef.current` (length `VARIED_N`=8 for varied/spread; 1 for shuffle).
- **`scheduleFadeAndStop` cancels its prior timer first** (Kotlin `cancelTimerInternal()` at entry; iOS must mirror — verified in build). So re-calling it re-arms cleanly with no new native API.
- **The night's end is fixed** by `endAtRef` (set once in `beginPlayback`). Skipping changes *what* plays and the *per-episode* clock, never the night length: the re-armed fade uses the **remaining** seconds (`endAtRef - now`), so the night still fades/stops at the same wall-clock moment.
- **No `features`/embed/YouTube touched** → lands in both `full` and `foss` automatically. No onnxruntime, no webview.

## Design

### `App.tsx` — `skipTo(ep)` (the one primitive)

Guard: a night is live (`nowRef.current` set, `endAtRef.current !== null`) and `ep.id !== nowRef.current.id`; else no-op.

0. **Guard against overlap** (`skippingRef`): `skipTo` awaits `play()` while the controls stay live, so ignore a second skip while one is in flight. And **`cancelTimer()` up front, before the await** — otherwise a late skip (final seconds) could let the *old* episode's native timer fire `onNightEnded` mid-re-arm and tear the night down.
1. **Record the outgoing episode** (same accounting `finishNight` does per episode, so a skipped-away episode still counts and won't be re-picked): `heardSec = round((now - startedAtRef.current)/1000)`; if `heardSec >= HEARD_SEC` (120) → `recordHeardPlay({id,title,feedId,startedAt: startedAtRef.current, heardSec})`. Add the outgoing id to `playedIdsRef.current` if absent.
2. **Switch the current episode:** `setNow(ep)`, `nowRef.current = ep`, `startedAtRef.current = now` (reset the per-episode heard clock only), `trimRef.current = loadState().settings.feedTrim[ep.feedId] ?? 1`.
3. **Drive native:** `setNowPlaying(ep.title, "sleepcast", "", 0)`; `await play(ep.url, 0)`; `remaining = (endAtRef.current - now)/1000`; `scheduleFadeAndStop(ep.id, remaining, FADE_SECONDS, trimRef.current)`.
4. **Update the reconcile marker** so a mid-episode kill reconciles the episode actually playing: `saveMarker({ ...same night fields, episodeId: ep.id, startedAt: startedAtRef.current, timerMinutes: remaining-minutes, nightMinutes: full-night-minutes, playedIds: playedIdsRef.current })`. `timerMinutes` shrinks to the current episode's remaining window (keeps `reconcileToLastNight`'s heard cap right), while the new **`nightMinutes`** field carries the full night length so the reconciled rest-ledger night isn't recorded as short.

**Two clocks.** `startedAtRef` is the CURRENT episode's start (reset on skip → per-episode heard). `nightStartedAtRef` is the whole night's start, set once in `beginPlayback` and **never reset** — the quarter-hour rule's `elapsedMs` reads *this*, so a restless listener who keeps skipping can't reset the clock and dodge the rule. **Untouched on skip:** `endAtRef`, `nightStartedAtRef`, `restRef` (holds its own night-start internally), `ruleSpentRef`, the 1 s tick — countdown, volume-fade reflection, rest detector, and quarter-hour rule keep running against the night, not the episode.

`onNightEnded` still reads `nowRef.current` as the ended episode — after a skip that is the switched-to episode, which is correct.

### `App.tsx` — `next()`

`const nextEp = nextPlayable(lineupRef.current, new Set(), nowRef.current?.id ?? null, getPlays())` (vendor `youtube-night.nextPlayable`, reused: prefers a not-current pick, weights by play history). If `nextEp` → `skipTo(nextEp)`; else no-op. (Podcasts have no "dead" set, so pass `new Set()`.)

### `PlayerScreen` — the list + next

New optional props: `lineup?: Episode[]`, `currentId?: string`, `onSelect?: (ep: Episode) => void`, `onNext?: () => void`. When `lineup && lineup.length > 1`, render below the current controls:
- a scrollable list (`ScrollView`, capped height) of the picks — each a `TouchableOpacity` row showing title (`numberOfLines={2}`) + feed title, the current one visually marked and non-tappable; `accessibilityRole="button"`, `accessibilityLabel="play <title>"`, `accessibilityState={{ selected: ep.id === currentId }}`.
- a **next** button (`testID="skip-next"`, `accessibilityLabel="next episode"`).

When `lineup` is absent or length ≤ 1 (shuffle, or callers that don't pass it) → render exactly as today (backward compatible). Feed titles come from a `feedTitlesRef`-derived map passed alongside, or looked up from the lineup's `feedId` via the existing `feedTitles` state.

`App.tsx` renders `<PlayerScreen … lineup={lineupRef.current} currentId={now?.id} onSelect={skipTo} onNext={next} />`.

## Testing

- **`skipTo` (App-level, via the existing App test harness / a focused unit on the handler):** mock `NightAudio`; assert on skip it calls `play(next.url,0)` then `scheduleFadeAndStop(next.id, ~remaining, 60, next-trim)` with `remaining < timerMinutes*60` and the night's `endAt` unchanged; the outgoing id lands in `playedIds`; `recordHeardPlay` fires only when heard ≥ 120 s; `setNowPlaying` gets the new title.
- **`next()`**: with a 3-episode lineup and current = lineup[0], `next()` skips to a different episode (not the current).
- **`PlayerScreen`**: with a >1 lineup, the list renders one labelled row per pick, the current row has `accessibilityState.selected`, tapping a row calls `onSelect(ep)`, the next button calls `onNext`; with a length-1 lineup (or no lineup prop) no list/next renders (existing tests stay green).
- **Regression:** existing PlayerScreen/App tests unchanged (props are optional/additive).
- **On-device (Pixel, both flavors implicitly — verify on `foss` since it's the same code):** start a varied night, see 8 picks, tap a different one → audio switches, countdown continues from where it was (night end unchanged), volume trim reflects the new feed; tap **next** → advances; night still fades/stops at the original time.

## Scope

- **In:** the `skipTo`/`next` handlers, the `PlayerScreen` list + next control, wiring, tests, device check. Applies to any multi-episode night (varied + spread) via the `lineup.length > 1` check; shuffle unchanged.
- **Out:** an audio-timeline **seek bar** within a track (a different, native-seek feature); reordering/removing picks; gapless auto-advance when an episode ends naturally (a podcast episode rarely ends before the sleep timer — the night is one episode faded out unless the listener skips); artwork per row; YouTube-night changes (`YouTubeNightScreen` already has its own skip).

## Done means

On a varied or spread night, `PlayerScreen` shows the eight picks; tapping one switches playback to it and tapping **next** advances — in both cases the sleep timer keeps counting to the same end and the night still fades and stops on schedule. The outgoing episode is counted (heard ≥ 120 s) and not re-offered. Shuffle nights and both build flavors are unaffected. No native code changes.
