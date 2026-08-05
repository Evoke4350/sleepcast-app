# YouTube Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add YouTube channels as a source — add by URL/@handle, parse the channel feed, and play a screen-on "YouTube night" (WebView IFrame player) with the same selection/fade/timer/sleep-ledger as podcasts.

**Architecture:** The vendor `youtube-night.ts` (transport/skip logic) and `youtube-media.ts` (`YouTubeMedia` over an injected `createPlayer → YTPlayerLike`) are reused. RN provides: a native YouTube-feed parser, a channel resolver, a WebView iframe player (`react-native-youtube-iframe`) adapted (async→sync via cache-polling) to `YTPlayerLike`, and a screen-on YouTube-night screen. Routing sends a YouTube-lead night to that screen; podcasts are unchanged. YouTube cannot play locked — the screen is kept awake.

**Tech Stack:** RN 0.86 new-arch, TypeScript, `react-native-webview` + `react-native-youtube-iframe`, `fast-xml-parser`, the `vendor/player` `youtube*`/`rest`/`engine` lib, Jest.

## Global Constraints

- Never edit `vendor/player/`. Reuse `youtube-night`, `youtube-media`, `youtube-errors`, and the pure URL helpers (`youtubeFeedUrl`, `isYouTubeFeedUrl`, `youtubeHandleUrl`, `channelIdFromHtml`, `isYouTubeLineup`) as-is. Only `parseYouTubeFeed` (DOMParser) and `youtube-api` (window.YT) get native replacements.
- YouTube playback is **screen-on only** (WebView embed can't background-play). The YouTube-night screen keeps the display awake; the UI must state this.
- `react-native-webview` is a native dep → Mac build; a device link gate (Task 4) must pass before building playback on it.
- A night's pool is single-kind (all YouTube or all podcast); mixing is blocked in setup.
- Run JS tests: `PATH=/opt/homebrew/bin:$PATH npx jest <path>`; typecheck `npx tsc --noEmit`. Both stay clean. TDD.

---

### Task 1: Native YouTube feed parser (`src/platform/youtube.ts`)

Reimplement `parseYouTubeFeed` (vendor uses DOMParser) with fast-xml-parser, and a `parseFeedFor` dispatcher.

**Files:**
- Create: `src/platform/youtube.ts`
- Test: `src/platform/youtube.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function parseYouTubeFeed(xmlText: string, feedId: string): Feed;  // Episodes carry youtubeId
  function parseFeedFor(xmlText: string, feedId: string, feedUrl: string): Feed;
  ```
- Consumes: `isYouTubeFeedUrl` (`vendor/player/src/lib/youtube`), `parseFeed` (`src/platform/feed` — podcast), types `Episode`/`Feed` (vendor `engine`).

- [ ] **Step 1: Write the failing test**

```ts
// src/platform/youtube.test.ts
import { parseYouTubeFeed, parseFeedFor } from "./youtube";

const YT_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>A Channel</title>
  <entry>
    <id>yt:video:ABC123abcd0</id>
    <yt:videoId>ABC123abcd0</yt:videoId>
    <title>Sleepy Rain</title>
    <published>2024-01-01T00:00:00+00:00</published>
    <media:group><media:thumbnail url="https://i.ytimg.com/x.jpg"/></media:group>
  </entry>
  <entry>
    <id>yt:video:ZZZ999zzzz9</id>
    <yt:videoId>ZZZ999zzzz9</yt:videoId>
    <title>Ocean</title>
    <published>2024-02-01T00:00:00+00:00</published>
  </entry>
</feed>`;

test("parses a YouTube Atom feed into episodes with youtubeId", () => {
  const feed = parseYouTubeFeed(YT_ATOM, "ytc");
  expect(feed.title).toBe("A Channel");
  expect(feed.episodes.map((e) => e.youtubeId)).toEqual(["ABC123abcd0", "ZZZ999zzzz9"]);
  expect(feed.episodes[0].title).toBe("Sleepy Rain");
  expect(feed.episodes[0].url).toContain("watch?v=ABC123abcd0");
  expect(feed.episodes[0].feedId).toBe("ytc");
});

test("parseFeedFor routes YouTube feed URLs to the YouTube parser", () => {
  const feed = parseFeedFor(YT_ATOM, "ytc", "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv");
  expect(feed.episodes[0].youtubeId).toBe("ABC123abcd0");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/platform/youtube.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/platform/youtube.ts
import { XMLParser } from "fast-xml-parser";
import type { Episode, Feed } from "../../vendor/player/src/lib/engine";
import { isYouTubeFeedUrl } from "../../vendor/player/src/lib/youtube";
import { parseFeed } from "./feed";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "entry",
  trimValues: true,
});

function text(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in (node as Record<string, unknown>)) {
    return text((node as Record<string, unknown>)["#text"]);
  }
  return "";
}

export function parseYouTubeFeed(xmlText: string, feedId: string): Feed {
  const doc = parser.parse(xmlText) as Record<string, any>;
  const feedNode = doc?.feed ?? {};
  const title = text(feedNode.title) || "YouTube channel";
  const entries: any[] = Array.isArray(feedNode.entry) ? feedNode.entry : feedNode.entry ? [feedNode.entry] : [];

  const episodes: Episode[] = [];
  for (const entry of entries) {
    const idText = text(entry["id"]);
    const videoId =
      text(entry["yt:videoId"]) ||
      idText.match(/^yt:video:([A-Za-z0-9_-]+)$/)?.[1] ||
      "";
    if (!videoId) continue;
    episodes.push({
      id: idText || `yt:video:${videoId}`,
      title: text(entry["title"]) || "untitled",
      url: `https://www.youtube.com/watch?v=${videoId}`,
      feedId,
      date: text(entry["published"]),
      youtubeId: videoId,
    });
  }

  const thumb = feedNode.entry && (Array.isArray(feedNode.entry) ? feedNode.entry[0] : feedNode.entry)?.["media:group"]?.["media:thumbnail"];
  const artwork = thumb && typeof thumb === "object" ? (thumb["@_url"] as string | undefined) : undefined;

  return { id: feedId, title, episodes, artwork };
}

export function parseFeedFor(xmlText: string, feedId: string, feedUrl: string): Feed {
  return isYouTubeFeedUrl(feedUrl) ? parseYouTubeFeed(xmlText, feedId) : parseFeed(xmlText, feedId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/platform/youtube.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/platform/youtube.ts src/platform/youtube.test.ts
git commit -m "feat: native YouTube Atom feed parser"
```

---

### Task 2: Resolve a YouTube channel URL (`src/platform/youtube-add.ts`)

Turn a pasted YouTube URL/@handle into a channel RSS feed URL.

**Files:**
- Create: `src/platform/youtube-add.ts`
- Test: `src/platform/youtube-add.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type YouTubeAdd = { ok: true; feedUrl: string } | { ok: false; reason: "video" | "unresolved" | "not-youtube" };
  async function resolveYouTubeFeedUrl(input: string, fetchText?: (url: string) => Promise<string>): Promise<YouTubeAdd>;
  ```
- Consumes: `youtubeFeedUrl` (`vendor/player/src/lib/youtube`), `youtubeHandleUrl`/`channelIdFromHtml` (`vendor/player/src/lib/youtube-resolve`).

- [ ] **Step 1: Write the failing test**

```ts
// src/platform/youtube-add.test.ts
import { resolveYouTubeFeedUrl } from "./youtube-add";

test("a channel URL passes straight through", async () => {
  const r = await resolveYouTubeFeedUrl("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv");
  expect(r).toEqual({ ok: true, feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv" });
});

test("a @handle is resolved by fetching the channel page", async () => {
  const fetchText = async (url: string) => {
    expect(url).toBe("https://www.youtube.com/@sleepy");
    return `<link rel="canonical" href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv">`;
  };
  const r = await resolveYouTubeFeedUrl("https://www.youtube.com/@sleepy", fetchText);
  expect(r).toEqual({ ok: true, feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv" });
});

test("a video URL reports 'video'", async () => {
  expect(await resolveYouTubeFeedUrl("https://www.youtube.com/watch?v=abc")).toEqual({ ok: false, reason: "video" });
});

test("a non-YouTube URL reports 'not-youtube'", async () => {
  expect(await resolveYouTubeFeedUrl("https://example.com/feed")).toEqual({ ok: false, reason: "not-youtube" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/platform/youtube-add.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/platform/youtube-add.ts
import { youtubeFeedUrl } from "../../vendor/player/src/lib/youtube";
import { youtubeHandleUrl, channelIdFromHtml } from "../../vendor/player/src/lib/youtube-resolve";

export type YouTubeAdd = { ok: true; feedUrl: string } | { ok: false; reason: "video" | "unresolved" | "not-youtube" };

const defaultFetch = (url: string) => fetch(url).then((r) => r.text());

export async function resolveYouTubeFeedUrl(
  input: string,
  fetchText: (url: string) => Promise<string> = defaultFetch,
): Promise<YouTubeAdd> {
  const yt = youtubeFeedUrl(input);
  if (!yt) return { ok: false, reason: "not-youtube" };
  if (yt.kind === "feed") return { ok: true, feedUrl: yt.url };
  if (yt.kind === "unsupported") return { ok: false, reason: "video" };
  // handle → fetch the channel page → channel id → feed url
  const pageUrl = youtubeHandleUrl(yt.handle);
  if (!pageUrl) return { ok: false, reason: "unresolved" };
  try {
    const html = await fetchText(pageUrl);
    const id = channelIdFromHtml(html);
    if (!id) return { ok: false, reason: "unresolved" };
    return { ok: true, feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${id}` };
  } catch {
    return { ok: false, reason: "unresolved" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest src/platform/youtube-add.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/platform/youtube-add.ts src/platform/youtube-add.test.ts
git commit -m "feat: resolve a YouTube URL/handle to a channel feed URL"
```

---

### Task 3: Wire YouTube feeds into the pool + add-flow + mix guard

Use `parseFeedFor` in the pool, route YouTube URLs through the resolver on add, and block mixed pools.

**Files:**
- Modify: `src/platform/feeds.ts` (use `parseFeedFor`)
- Modify: `src/screens/SetupScreen.tsx` (add-feed detects YouTube; mix guard)
- Modify: `src/platform/feeds.test.ts`, `src/screens/SetupScreen.test.tsx`

**Interfaces:** Consumes `parseFeedFor` (Task 1), `resolveYouTubeFeedUrl` (Task 2), `youtubeFeedUrl`/`isYouTubeFeedUrl` (vendor).

- [ ] **Step 1: `buildPool` parses per feed URL (failing test first)**

In `src/platform/feeds.ts`, change the parse call from `parseFeed(xml, f.id)` to `parseFeedFor(xml, f.id, f.url)` (import `parseFeedFor` from `./youtube`). Add a test: a feed whose URL is a YouTube feed URL and whose cached XML is a YouTube Atom doc yields episodes with `youtubeId`.

- [ ] **Step 2: SetupScreen add-feed routes YouTube URLs (failing test first)**

In `addFeed`, if `youtubeFeedUrl(url.trim())` is non-null, call `resolveYouTubeFeedUrl(url.trim())`; on `ok`, `addCustomFeed(state, feedUrl, undefined)`; on `!ok`, set a feed error (`"that's a video, not a channel"` / `"couldn't find that channel"`). Otherwise the existing `addCustomFeed` path. Test: adding `https://www.youtube.com/channel/UC…` stores the `feeds/videos.xml?channel_id=UC…` feed (mock `resolveYouTubeFeedUrl` if needed, or pass the channel URL which resolves synchronously via `youtubeFeedUrl`).

- [ ] **Step 3: Mix guard (failing test first)**

Compute `mixed = enabledFeeds.some(isYouTubeFeedUrl) && enabledFeeds.some((u) => !isYouTubeFeedUrl(u))`. When `mixed`, show a note (`testID="mix-warning"`: "a YouTube night can't mix with podcast feeds — turn one kind off") and disable the start buttons (`disabled` + a no-op). Test: enabling a YouTube feed alongside a podcast feed renders `mix-warning` and start is disabled.

- [ ] **Step 4: Implement all three, run tests + typecheck**

Run: `PATH=/opt/homebrew/bin:$PATH npx jest && PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit`
Expected: all pass, clean.

- [ ] **Step 5: Commit**

```bash
git add src/platform/feeds.ts src/screens/SetupScreen.tsx src/platform/feeds.test.ts src/screens/SetupScreen.test.tsx
git commit -m "feat: YouTube feeds in the pool, add-by-URL, and the single-kind guard"
```

---

### Task 4: WebView deps + link gate (Pixel 7)

Add the deps and prove the WebView + iframe player renders and plays on-device under the new architecture, before building the feature on it.

**Files:**
- Modify: `package.json`
- Create: `src/youtube/WebViewSmoke.tsx` (temporary probe, deleted in Task 5)

- [ ] **Step 1: Install**

```bash
PATH=/opt/homebrew/bin:$PATH npm install react-native-webview react-native-youtube-iframe
```

- [ ] **Step 2: Device link gate**

Wire a temporary screen that renders `<YoutubePlayer height={200} play videoId="dQw4w9WgXcQ" />` (from `react-native-youtube-iframe`) behind a dev entry, build + install:
```bash
cd /Users/windowlicker/sleepcast-app
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=/opt/homebrew/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
pkill -f "react-native start"; nohup npx react-native start > /tmp/metro-s6.log 2>&1 &
npx react-native run-android
```
Confirm: BUILD SUCCESSFUL, the WebView renders, and tapping play produces audio (screencap + listen). **If `react-native-webview` won't link under bridgeless or the iframe won't play, STOP and report BLOCKED** — the feature can't proceed without it. Remove the probe wiring before Task 5.

- [ ] **Step 3: Commit deps**

```bash
git add package.json package-lock.json android/ ios/ 2>/dev/null
git commit -m "build: add react-native-webview + youtube-iframe for the YouTube source"
```

---

### Task 5: WebView player adapter (`src/youtube/YouTubePlayer.tsx`)

A component wrapping `react-native-youtube-iframe`, exposing a `createPlayer(args) → YTPlayerLike` that `YouTubeMedia` can drive. Bridge the async ref API to the synchronous `YTPlayerLike` with a cache-polling loop.

**Files:**
- Create: `src/youtube/YouTubePlayer.tsx`
- Test: `src/youtube/ytPlayerAdapter.test.ts` (the pure adapter, extracted so it's testable without a WebView)

**Interfaces:**
- Produces a pure adapter factory:
  ```ts
  // takes async getters + imperative controls, returns the synchronous YTPlayerLike + a cache pump
  interface AsyncPlayerCtl {
    getCurrentTime(): Promise<number>; getDuration(): Promise<number>;
    play(): void; pause(): void; setVolume(pct: number): void; load(videoId: string, start?: number): void; destroy(): void;
  }
  function makeYtAdapter(ctl: AsyncPlayerCtl): { player: YTPlayerLike; pump(): Promise<void>; setState(code: number): void };
  ```
- `YouTubePlayer.tsx` wires `react-native-youtube-iframe`'s ref (`getCurrentTime`/`getDuration` promises, `onChangeState`) into `AsyncPlayerCtl`, runs `pump()` on a ~250ms interval, and provides `createPlayer` to consumers.

- [ ] **Step 1: Write the failing adapter test**

```ts
// src/youtube/ytPlayerAdapter.test.ts
import { makeYtAdapter } from "./ytPlayerAdapter";

test("sync getters return the latest pumped async values and state", async () => {
  let t = 5, d = 100;
  const calls: string[] = [];
  const ctl = {
    getCurrentTime: async () => t, getDuration: async () => d,
    play: () => calls.push("play"), pause: () => calls.push("pause"),
    setVolume: (p: number) => calls.push("vol:" + p), load: (id: string) => calls.push("load:" + id), destroy: () => calls.push("destroy"),
  };
  const a = makeYtAdapter(ctl);
  await a.pump();
  expect(a.player.getCurrentTime()).toBe(5);
  expect(a.player.getDuration()).toBe(100);
  a.setState(1); // YT PLAYING
  expect(a.player.getPlayerState()).toBe(1);
  a.player.setVolume(50); a.player.playVideo();
  expect(calls).toContain("vol:50"); expect(calls).toContain("play");
  t = 9; await a.pump();
  expect(a.player.getCurrentTime()).toBe(9);
});
```

- [ ] **Step 2–4:** Run (fail) → implement `ytPlayerAdapter.ts` (cache the last `getCurrentTime`/`getDuration`/state; `YTPlayerLike` getters read the cache; controls delegate to `ctl`) → run (pass). Then build `YouTubePlayer.tsx` around `react-native-youtube-iframe` wiring the ref into `ctl`, the 250ms `pump()`, `onChangeState → setState`, and exposing `createPlayer`. The component itself is verified on-device (Task 8); the adapter is unit-tested here.

- [ ] **Step 5: Commit**

```bash
git add src/youtube/YouTubePlayer.tsx src/youtube/ytPlayerAdapter.ts src/youtube/ytPlayerAdapter.test.ts
git commit -m "feat: WebView YouTube player adapted to the vendor YTPlayerLike"
```

---

### Task 6: YouTube-night screen (`src/screens/YouTubeNightScreen.tsx`)

The screen-on night: player + JS fade/timer + dead-video skip + rest recording + keep-awake.

**Files:**
- Create: `src/screens/YouTubeNightScreen.tsx`
- Test: `src/screens/YouTubeNightScreen.test.tsx`

**Interfaces:**
- `YouTubeNightScreen({ lineup, minutes, trim, onEnd }: { lineup: Episode[]; minutes: number; trim: number; onEnd: () => void })`.
- Consumes `YouTubeMedia` (vendor `youtube-media`), `transportFor`/dead-video/`pickNextEpisode` (vendor `youtube-night`), `effectiveVolume` (engine), `RestSession`/`appendNight` (rest), `YouTubePlayer.createPlayer` (Task 5).

- [ ] **Steps:** TDD what's testable without a live WebView by injecting a fake `createPlayer` (a `YTPlayerLike` stub): assert the fade calls `setVolume` with `effectiveVolume(remaining, 60, trim)*100`; the timer end stops and calls `onEnd` after `appendNight`; a video that never starts past the dead-video window advances to the next (`pickNextEpisode`) or ends the night if none left; the display shows the transport from `transportFor`. Keep-awake: call a keep-awake side effect on mount / release on unmount (a `KeepAwake` helper — `react-native`'s `AppState` can't keep the screen on; use the WebView's own video keep-screen-on, and set a comment/TODO if a dedicated keep-awake dep is deferred). Real playback is Task 8. Commit: `feat: screen-on YouTube-night flow (fade, timer, skip, record)`.

---

### Task 7: Route YouTube nights in `App.tsx`

Send a YouTube-lead lineup to `YouTubeNightScreen`; podcasts unchanged.

**Files:**
- Modify: `App.tsx`
- Modify: `__tests__/App.night.test.tsx`

- [ ] **Steps:** In `onStart`/`onResume`, after `chooseLineup`, if `isYouTubeLineup([r.lead])` (vendor `youtube-night`), set a `youtubeSession` state (`{lineup, minutes, trim}`) and render `YouTubeNightScreen` instead of the native `beginPlayback`/`PlayerScreen` path; `onEnd` clears it back to setup. Podcast path (native `scheduleFadeAndStop` + `PlayerScreen`) is untouched. Test (mock `YouTubeNightScreen` and feeds so the pool is a YouTube episode): starting shows `YouTubeNightScreen`, not `PlayerScreen`; a podcast pool still shows `PlayerScreen`. Commit: `feat: route YouTube nights to the WebView player`.

---

### Task 8: On-device verification (Pixel 7)

- [ ] Build + install HEAD. Add a real YouTube channel by URL (e.g. a lofi/rain channel); confirm it appears as a feed and the mix guard fires if a podcast is also enabled.
- [ ] Start a shuffle YouTube night (screen on): confirm a video's audio plays, the on-screen volume/countdown update, the last minute fades, and it stops at the timer; the night appears in `nights ›`.
- [ ] Confirm the documented limitation: locking the screen pauses YouTube (expected) — note it.
- [ ] Screenshot the YouTube feed, a playing YouTube night, and the recorded night.

---

## Self-Review

**Spec coverage:** native YouTube feed parser + dispatcher (Task 1) ✓; channel resolve/add (Task 2) ✓; pool + add-flow + mix guard (Task 3) ✓; deps + WebView link gate (Task 4) ✓; player adapter async→sync (Task 5) ✓; screen-on night flow with fade/timer/skip/record (Task 6) ✓; routing (Task 7) ✓; device verification incl. the screen-on limitation (Task 8) ✓; stream extraction never used; `vendor/player` unedited ✓.

**Placeholder scan:** the WebView-dependent pieces (Task 5 component, Task 6 keep-awake, Task 8) are verified on-device rather than in unit tests because a WebView can't run under Jest — the pure adapter, fade math, skip logic, and routing ARE unit-tested with injected fakes. The keep-awake mechanism is flagged as an implementation-time choice (WebView video vs a dedicated dep).

**Type/name consistency:** `parseYouTubeFeed`/`parseFeedFor`, `resolveYouTubeFeedUrl`/`YouTubeAdd`, `makeYtAdapter`/`YTPlayerLike`/`AsyncPlayerCtl`, `YouTubeNightScreen({lineup,minutes,trim,onEnd})`, `isYouTubeLineup`, `isYouTubeFeedUrl` are used consistently across tasks and match the vendor signatures read from `youtube.ts`/`youtube-resolve.ts`/`youtube-night.ts`/`youtube-media.ts`.
