# sleepcast for iOS — thin slice

**Status:** design, approved 2026-07-31. Not implemented.

A bare React Native app (no Expo) that plays a sleep podcast and fades out.
This document covers the first slice only: the parts that are hard to get right
natively, proven on a real phone, before any of the product is ported.

## Why native at all

The web player already works. Three things it structurally cannot do decide
this:

1. **The relay disappears.** Browsers cannot fetch podcast feeds cross-origin,
   which is the only reason `/api/relay` exists — and with it an SSRF guard,
   DNS-rebinding address pinning, a rate limiter and a feed sniff. That is the
   most dangerous code in the project and native does not need any of it: a
   native HTTP client has no CORS. The server stops existing.

2. **Background execution is real.** On 2026-07-30 the web player was found to
   drive its volume fade and its stop from `setInterval` alone. Browsers
   throttle background intervals to roughly once a minute, and the phone is
   locked for practically all of a sleep timer, so a 60-second fade was being
   sampled once or twice. The fix drove it from the audio element's
   `timeupdate` as well. An iOS app holding the background-audio entitlement is
   not suspended at all, so the fade is simply a timer that runs.

3. **Motion sensing becomes possible.** The W3C Device Orientation spec gates
   `devicemotion` on `document.visibilityState === "visible"` — normatively,
   with the literal step *"If document's visibility state is not visible,
   return"* — so overnight motion data is unobtainable in a web page on any
   browser. Native has no such gate, and an app holding the background-audio
   entitlement stays alive, which is the mechanism Sleep Cycle and Sleep as
   Android rely on.

   **This is not in v1, and it is not obviously a good idea.** Actigraphy has
   high sensitivity to sleep but poor specificity to wake — it mistakes lying
   still while awake for sleep, which is why it overestimates sleep time, worst
   of all in insomniacs. That is precisely the residual error in the current
   detector (see `docs/gated-model.md` in sleepcast-player: a quiet listener who
   lets the timer fade untouched is counted as slept by design) and precisely
   this app's user base. If it is built, it must be validated against
   self-labelled nights before it is trusted, not assumed.

## Scope

**In:**

- Launch, pick one built-in feed
- Start a night: shuffle an episode, play it
- Sleep timer: fade the volume over the final 60 seconds, then stop
- Correct behaviour with the screen off for the whole session
- Lock-screen and Control Center transport (title, artwork, play/pause)

**Out, deliberately:** the sleep detector, the night ledger, calibration, the
quarter-hour rule, resume-last-night, position memory, episode search, custom
feeds, the varied mix. All of that already exists and ports later; none of it
proves anything about whether the native shell works.

The slice is chosen so that if it works on a phone overnight, the risky part is
finished.

## Repository shape

```
sleepcast-ios/
  ios/                     Xcode project, Podfile, Info.plist
    NightAudio.swift       AVPlayer + AVAudioSession + Now Playing
  vendor/player/           submodule → github.com/Evoke4350/sleepcast-player
  src/
    platform/storage.ts    MMKV, polyfilling localStorage
    platform/feed.ts       native XML → Episode[]
    audio/NightAudio.ts    TS interface to the native module
    audio/fade.ts          fadeVolume → setVolume loop
    screens/NightScreen.tsx
    App.tsx
  index.js
```

`sleepcast-player` stays canonical for logic, exactly as it is for the website.
One detector, one set of tests, fixes flowing to both consumers.

## Three decisions that carry weight

### MMKV, not AsyncStorage

The shared code calls `localStorage.getItem`/`setItem` **synchronously**, in
roughly 40 places across `store.ts`, `rest/ledger.ts` and `rest/surface.ts`.

MMKV is synchronous, so `global.localStorage` can be polyfilled against it and
the shared code runs unmodified. AsyncStorage is promise-based; adopting it
would mean refactoring every one of those call sites in a repository the
website also depends on, for no benefit.

This is the decision that makes submodule sharing viable at all.

### The feed parser is not shared in v1

`parseFeedXml` in `engine.ts` uses `DOMParser`, `querySelector`, `.children`
and `.localName`. No React Native XML library implements that surface
faithfully — `@xmldom/xmldom` has no `querySelector` — and shimming a DOM is
more work than the parser.

So v1 writes a native parser producing the same `Episode[]`, and shares only
genuinely platform-neutral code. Unifying later means refactoring
`sleepcast-player` to inject a parse backend, which is worth doing and is not
worth blocking the first build on.

Everything else ports untouched: the whole `rest/` engine, `plays.ts`,
`positions.ts`, `timer-feel.ts`, `episode-search.ts`, `semantic-math.ts`, and
`fadeVolume`/`formatTime` from `engine.ts`.

### Audio — a thin custom native module

The original plan was `react-native-track-player`. Research on 2026-07-31
killed it, and with it the mitigation this document previously relied on.

- The free `react-native-track-player` is **frozen at 4.1.2 (2025-08-12)** — a
  legacy bridge module, ~12 months stale.
- Its longtime maintainer announced on 2026-03-03 that he is no longer
  contributing and is migrating his own apps elsewhere. Roughly 4 commits to
  main in all of 2026.
- **v5 went commercial and closed-source** as `@rntp/player`: EUR 999/yr
  minimum, no free tier.
- Issue #2665 (opened 2026-07-17, still unanswered) reports an **iOS 26
  ~20-second main-thread hang on play, with the watchdog killing the app when
  backgrounded.** For an app whose entire job is playing audio with the screen
  off, that is disqualifying rather than inconvenient.
- **The escape hatch named below is gone.** RN 0.82 (Oct 2025) removed the
  `newArchEnabled=false` toggle, so "fall back to the old architecture" is no
  longer a thing that can be done.

The alternatives were `expo-audio` (MIT and healthy, but an Expo module, and
Expo was ruled out) and `@rntp/player` at EUR 999/yr. **Decision: write our
own.**

This is defensible because the requirement is unusually narrow. The app needs
to play a URL, set a volume, keep playing while backgrounded, and publish Now
Playing information. It does not need a queue, gapless playback, crossfading,
casting, offline download management, or any of the surface a general-purpose
library carries. A dependency would be mostly things we never call, maintained
by someone who can stop — as just happened.

Surface, deliberately small:

```
play(url: string, startAtSeconds: number): Promise<void>
pause(): void
resume(): void
stop(): void
setVolume(v: number): void        // 0..1 — the fade drives this
getPosition(): Promise<number>
setNowPlaying(title, artist, artworkUrl, duration): void
onEnded / onError / onRemoteCommand   // events to JS
```

Native side: `AVPlayer` for playback, `AVAudioSession` with the `.playback`
category so audio survives the lock screen and the mute switch,
`MPNowPlayingInfoCenter` for lock-screen metadata, `MPRemoteCommandCenter` for
transport. Info.plist declares `UIBackgroundModes: audio`.

The volume fade stays in TypeScript — `fadeVolume` from the shared repo,
already tested — driving `setVolume`. Keeping the fade curve in shared, tested
code and the native module dumb is the point: the module should be the least
clever part of the system.

**Cost, stated honestly:** we own it, and it cannot be compiled or tested from
the Linux machine where the TypeScript is written. Every iteration on the
native side needs the Mac.

**Sequence audio before OTA.** OTA is the low-risk decision; this was not.

## Known risks

- **New Architecture is now mandatory.** RN 0.82 removed the
  `newArchEnabled=false` toggle. An earlier draft of this document proposed
  disabling it as a fallback; that option does not exist. Any audio dependency
  must be New-Architecture-native.
- **Bare RN means manual native work**: CocoaPods, `UIBackgroundModes: audio`
  in Info.plist, signing configuration.
- **App Review will eventually ask** why an app plays silence-adjacent audio for
  hours in the background. Not a v1 problem; worth knowing it is coming.

## Division of labour

This is unusually stark and worth stating plainly. All TypeScript, the Podfile,
the Info.plist entries and native module configuration can be written on Linux.
**Nothing can be built there.** `pod install`, Xcode, the simulator, codesigning
and every device test happen on the Mac.

Distribution is via the Apple Developer Program ($99/yr), which gives one-year
provisioning and TestFlight.

## Done means

A build on a physical iPhone that plays an episode, has the screen locked for
the full timer, and is heard to fade smoothly to silence and stop — with the
last minute audibly a ramp rather than a cut.

Nothing short of that counts, because the whole reason for the native version is
that the browser could not be trusted to do it.

## Frontend updates without an App Store round trip

Requirement: ship JS changes the way Sparkle ships desktop updates. This works,
within a boundary that happens to suit the project.

**What can ship OTA:** the JS bundle — screens, logic, and the shared player
code. After the thin slice, nearly everything left to build (the detector, the
ledger, the quarter-hour rule, search, custom feeds, OPML) is pure TypeScript,
so nearly all of it ships this way.

**What cannot:** anything native. Adding a library, editing Info.plist,
changing the audio session, bumping React Native.

### Tool: hot-updater, self-hosted

MIT, 0.35.9 (2026-07-31), ~33k weekly downloads, released four times in the ten
days to that date. Self-hosting needs nothing exotic: `@hot-updater/server`
behind Hono on a Fly Machine, a Drizzle/Postgres adapter, and any S3-compatible
bucket — `s3Storage()` takes an explicit endpoint, so Fly Tigris works
directly. No Supabase or Cloudflare dependency; those are optional plugins.

**Two caveats to hold:** it is pre-1.0, so minor bumps can carry native
changes; and one maintainer accounts for roughly 800 of ~1,060 contributions.
Real project, thin bus factor.

### Rollback is the requirement, not push

A bad bundle on a bedtime app does not surface as a crash report at 2pm. It
surfaces as someone lying in the dark. So the acceptance criterion for any OTA
tool is automatic recovery, and hot-updater meets it:

- Two slots. A new bundle installs as **staging**; the last known-good is kept
  as **stable**.
- `HotUpdater.wrap()` promotes staging to stable **only after a first
  successful render**. The API throws if neither wrap nor init is configured,
  so the safety net cannot be omitted by accident.
- A crash before promotion auto-reverts on next launch — to the last stable
  bundle, or to the embedded one if there is no stable fallback.
- The failed bundle ID goes into a crash history that **blocks re-application**
  until explicitly cleared.

For contrast, `expo-updates` only catches fatals within 10 seconds of first
render and will only fix forward after content appears — it does not roll back.

### App Store risk, as measured rather than assumed

Apple has never amended the interpreted-code clause, and OTA JS updates remain
permitted. The documented rejections do not work the way one might expect:

- The trigger is **the presence of the update machinery**, cited under
  **guideline 2.3.1 (hidden features)** — not the payload, and not 2.5.2. In
  the one in-window case (2024) no update was even pending. Reviewers static-
  scan binaries for OTA SDK symbol names.
- The base rate is low: one GitHub-wide hit since 2024, none in 2025, and
  vendors running thousands of releases report no rejections.

Practical consequences, which are cheap to honour: **no in-app update dialog**,
keep the app's stated purpose stable, and do not gate unreviewed features
behind OTA flags.
