# Slice 10 — Back to home while a night keeps playing

**Status:** design 2026-08-06. Lets the listener leave the player back to the home (setup) screen while a podcast night keeps playing, with a persistent "now playing" banner to return. Pure-TS/RN, both flavors. Not yet built.

## Why

Today the only way off `PlayerScreen` is **stop**, which ends the night. But the audio is a native foreground service that already survives backgrounding — so there's no reason leaving the player must stop it. This adds a **home** control on the player that returns to `SetupScreen` while playback continues, and a **now-playing banner** on home to jump back. Starting a new night from home while one plays **replaces** it.

## Key facts this builds on

- Routing in `App.tsx` is a single state-driven ladder: `playing && now → PlayerScreen`, else `SetupScreen`. There is no "both at once" today.
- Native owns playback + the fade/stop timer (foreground service); it keeps running regardless of which JS screen is mounted. The 1 s tick (`setRemaining`/`setVolume`) also keeps running from `beginPlayback`'s interval, so a banner countdown stays live.
- Pure JS/RN — no `features`/embed/YouTube, no native changes → both flavors automatically.

## Design

### `App.tsx`

- New state `const [atHome, setAtHome] = useState(false)`.
- **Routing:** the player branch becomes `playing && now && !atHome`. When `atHome` is true while playing, the ladder falls through to the `SetupScreen` branch, which now also receives the live-night info.
- **`beginPlayback`** sets `setAtHome(false)` (a freshly started night opens the player). **`finishNight`** sets `setAtHome(false)` (a night ending clears the flag so home is clean next time).
- **`PlayerScreen`** gets `onHome={() => setAtHome(true)}`.
- **`SetupScreen`** gets, when `playing && now`: `nowPlaying={{ title: now.title, remaining }}` and `onReturnToPlayer={() => setAtHome(false)}`.
- **Replace on start (`onStart`/`onResume`):** after `chooseLineup` yields a lineup (`r`), if a night is already live (`nowRef.current`), abandon it first — call the existing `endSession()` (cancels the native timer, stops audio, records the night as `abandoned` through the one `finishNight` funnel) — then begin the new night. This prevents two nights' native timers/bookkeeping from overlapping. (Applies to the podcast path; the YouTube path already replaces via `setYtSession`.)

### `SetupScreen`

- New optional props: `nowPlaying?: { title: string; remaining: number }`, `onReturnToPlayer?: () => void`.
- When `nowPlaying` is set, render a **banner** as the first child of the setup `ScrollView`: a full-width `TouchableOpacity` (`testID="now-playing-banner"`, `accessibilityRole="button"`, `accessibilityLabel="return to now playing, <title>, <human countdown>"`) showing `♪ now playing`, the title (`numberOfLines={1}`), and `formatTime(remaining)`, with a `›` affordance. `onPress` → `onReturnToPlayer`. Absent → nothing renders (unchanged home).

### `PlayerScreen`

- New optional prop `onHome?: () => void`. When present, add a **home** control (`testID="home"`, `accessibilityRole="button"`, `accessibilityLabel="back to home, keep playing"`) next to stop (and next, when shown). Absent → unchanged.

## Scope

- **In:** the `atHome` state + routing, the player home control, the setup now-playing banner, replace-on-start, tests, device check. Podcast nights, both flavors.
- **Out:** YouTube nights (screen-on WebView playback can't keep audio when navigated away — a known IFrame limitation, not something a flag fixes); a full mini-player with transport controls on home (the banner is a return affordance, not a second player); lock-screen/notification changes (native already shows the media notification).

## Testing

- **`SetupScreen`**: with `nowPlaying` set, the banner renders with the title + a countdown and its `onPress` fires `onReturnToPlayer`; without it, no banner (existing tests stay green).
- **`PlayerScreen`**: with `onHome`, a `home` button renders and fires `onHome`; without it, no home button (existing tests green).
- **`App`**: tapping home on the player routes to `SetupScreen` while `playing` stays true and the native audio is NOT stopped (mock `NightAudio`: `stop`/`cancelTimer` not called on going home); the banner shows the current title; tapping the banner returns to the player. Starting a new night from home while one plays calls `endSession` (stop + cancel) once, then `scheduleFadeAndStop` for the new episode; the old night is recorded abandoned.
- **On-device (Pixel, foss):** start a night → tap home → land on setup with audio still playing and a now-playing banner counting down → tap banner → back on the player, same countdown → tap home → start a different night → old one replaced, new one plays.

## Done means

From a playing podcast night, a **home** control returns to the setup screen with the audio and timer still running; a **now-playing banner** on home shows the episode + countdown and taps back into the player. Starting a new night from home replaces the current one. Stop still ends the night. Shuffle/varied/spread and both flavors all behave the same; no native changes.
