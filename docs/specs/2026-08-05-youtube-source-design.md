# Slice 6 — YouTube Source (screen-on)

**Status:** design 2026-08-05. Sixth parity slice, the largest. Not yet built.

Adds YouTube channels as a source: add a channel by URL/@handle, it shows up as a feed, and a "YouTube night" plays its videos' audio with the same shuffle/spread/varied selection, fade, timer, and sleep-ledger as podcasts.

## The hard constraint, stated first

YouTube playback uses **Google's official IFrame Player API** (an embedded player), exactly as the web player does — never stream extraction (that is ToS-violating and constantly breaks). On React Native the IFrame player is a **WebView**, and **a WebView YouTube player cannot play with the screen locked**: WebView audio suspends on background and YouTube's embed forbids background audio.

So, unlike podcasts (native ExoPlayer/AVPlayer, locked-screen fade via slice 2), **a YouTube night runs screen-on only** — the app keeps the screen awake for its duration, the fade/timer are JS-driven (JS runs because the screen is on), and there is no locked-screen background audio. This matches the web player's behavior for YouTube. It is a real limitation the UI must state, not hide.

## Reuse — the pure engine

Consumed unchanged from `vendor/player`:
- `youtube-night.ts` — `transportFor(state)`, dead-video/`giveUp` detection, retries, `isYouTubeLineup(pool)`, `pickNextEpisode`. Pure.
- `youtube-media.ts` — `YouTubeMedia`, a state machine over an injected `createPlayer(args): YTPlayerLike`. The seam we implement against.
- `youtube-errors.ts` — `classifyYouTubeError(code)`.
- The pure URL helpers in `youtube.ts`/`youtube-resolve.ts` — `youtubeFeedUrl`, `isYouTubeFeedUrl`, `youtubeHandleUrl`, `channelIdFromHtml`.
- Selection (`chooseLineup`), the rest ledger, fade curve (`effectiveVolume`) — all reused; a YouTube Episode is just an `Episode` with a `youtubeId`.

The **only** browser-bound pieces are `youtube-api.ts` (`loadYouTubeApi`, injects `window.YT`) and `parseYouTubeFeed` (DOMParser). Both get native replacements.

## New native code

```
src/platform/youtube.ts      native parseYouTubeFeed (Atom → Episode[] with youtubeId), via fast-xml-parser
src/platform/youtube-add.ts  resolve a pasted YouTube URL/@handle → channel RSS feed URL (fetch + the pure helpers)
src/youtube/YouTubePlayer.tsx  a WebView iframe player (react-native-youtube-iframe) + a createPlayer adapter → YTPlayerLike
src/screens/YouTubeNightScreen.tsx  the YouTube-night UI: player + JS fade/timer + rest session + record night
```

### Feed parsing — `src/platform/youtube.ts`

`parseYouTubeFeed(xml, feedId): Feed` reimplemented with `fast-xml-parser` (same precedent as `feed.ts`/`opml.ts`): Atom `<entry>`, `<yt:videoId>` (fallback: `<id>` `yt:video:ID`), title, `<published>`, and a thumbnail for artwork. Episodes get `youtubeId` and a watch-page `url` (for tracing, not streaming). A `parseFeedFor(xml, feedId, feedUrl)` dispatches to this or the podcast `parseFeed` by `isYouTubeFeedUrl(feedUrl)` — used by the multi-feed pool assembly so a YouTube feed's XML is parsed correctly.

### Adding a channel — `src/platform/youtube-add.ts`

`resolveYouTubeFeedUrl(input): Promise<string | null>`: if `input` is already a channel/feed URL, return `youtubeFeedUrl(input)`; if it's an `@handle` or channel page, fetch the page (native HTTP) and `channelIdFromHtml` → `https://www.youtube.com/feeds/videos.xml?channel_id=<id>`. `SetupScreen`'s add-feed detects a YouTube URL and routes through this before `addCustomFeed` (which stores it as a normal feed — `isYouTubeFeedUrl` marks it at play time).

### The player — `src/youtube/YouTubePlayer.tsx`

`react-native-youtube-iframe` (+ its peer `react-native-webview`) renders the iframe in a WebView. Its ref API is **async** (`getCurrentTime(): Promise<number>`, `getDuration`, state via `onChangeState`), but the vendor `YTPlayerLike` is **synchronous**. Bridge with a **cache-polling adapter**: a ~250ms loop calls `getCurrentTime()`/`getDuration()` and caches the latest; `onChangeState` caches the YT state code; the synchronous `YTPlayerLike.getCurrentTime()/getDuration()/getPlayerState()` return the cached values (the fade samples ~1s, so 250ms cache is ample). `setVolume`, `playVideo`, `pauseVideo`, `loadVideoById`, `destroy` map to ref calls. `createPlayer(args)` wires `onReady`/`onEnded`/`onError` from the component's callbacks and returns this adapter to `YouTubeMedia`.

### The night — `src/screens/YouTubeNightScreen.tsx`

Given a YouTube lineup + timer, it: mounts `YouTubePlayer`, drives `YouTubeMedia`, runs a JS 1s fade/timer (`effectiveVolume(remaining, FADE_SECONDS, trim)` → `setVolume(percent*100)`), applies the `youtube-night` dead-video/skip logic, keeps the screen awake for the night, records the night to the rest ledger (`RestSession` + `appendNight`), and stops at the timer. Reuses the same rest-detector wiring as podcasts. A small "screen stays on for YouTube" note.

## Routing

`chooseLineup` runs over the assembled pool as today. In `App.tsx`, after a lineup is chosen, if `isYouTubeLineup([lead])` (the lead episode has a `youtubeId`), render `YouTubeNightScreen` instead of the native `PlayerScreen`/`scheduleFadeAndStop` path. Podcast nights are unchanged.

**Mutual exclusivity.** A pool that mixes YouTube and podcast feeds is ambiguous. Following the web, `SetupScreen` shows a note and blocks start when both kinds are enabled ("a YouTube night can't mix with podcast feeds — turn one kind off"); each night is single-kind.

## Dependencies + native gate

New deps: `react-native-webview` (native — Fabric/new-arch supported) and `react-native-youtube-iframe` (JS wrapper). This is a **native dependency → Mac build**, and needs a **link gate** (like slice 1's onnxruntime): before building the feature on it, verify a bare WebView + the iframe player renders and plays on the Pixel 7 under the new architecture. If it will not link/play, stop and report.

## Testing

- Pure engine tests already green in `vendor/player` (`youtube*.test.ts`) — unchanged.
- **New RN tests:**
  - `parseYouTubeFeed`: a sample YouTube Atom feed → Episodes with the right `youtubeId`/title/date; a non-YouTube feed still routes to the podcast parser via `parseFeedFor`.
  - `resolveYouTubeFeedUrl`: a channel URL passes through; an `@handle` fetch (mocked) → the `channel_id` feed URL; a non-YouTube input → null.
  - The `createPlayer` cache adapter: fed fake async values + state callbacks, the synchronous getters return the latest cached values; `YouTubeMedia` drives it (play/volume/ended) correctly.
  - Routing: a YouTube lead renders `YouTubeNightScreen`; a podcast lead renders `PlayerScreen`. The mix guard blocks start with both kinds enabled.
  - `YouTubeNightScreen`: the fade computes `effectiveVolume` → `setVolume` percent; timer end stops + records a night; a dead video skips per `youtube-night`.
- **On-device (Pixel 7):** the WebView link gate; then add a real YouTube channel, start a YouTube night, confirm audio plays with the screen on, the volume fades near the timer, it stops at the timer, and the night appears in the sleep history. Explicitly confirm (and accept) that locking the screen pauses it.

## Scope

- **In:** add YouTube channels, native YouTube-feed parsing, a WebView iframe player adapted to `YouTubeMedia`, a screen-on YouTube-night flow (fade/timer/skip/record), routing + the mix guard, the WebView link gate.
- **Out:** locked-screen/background YouTube audio (impossible via the embed — the app keeps the screen on instead); the brown-noise generator and auto-compressor (separate slices); the drift game; any stream-extraction path.

## Done means

On the Pixel 7, screen on: add a YouTube channel by URL, start a shuffle/spread/varied YouTube night, hear it play, watch the last minute fade and stop at the timer, and see the night recorded in the sleep history — with the UI making clear that YouTube nights need the screen on. Podcast nights (native, locked-screen) are unchanged.
