// The screen-on YouTube night: WebView player + JS fade/timer + dead-video
// skip + rest recording.
//
// Podcast nights (PlayerScreen/App.tsx) hand the fade and the stop timer to
// native, which keeps running while the screen is locked and JS is
// suspended. A YouTube night can't do that — playback goes through Google's
// embedded iframe in a WebView, which native has no access to — so this
// screen drives its own countdown on a plain JS `setInterval`. That only
// keeps firing while the screen is *on*, which is also exactly the
// condition a playing HTML5 video (the iframe's own <video> element) holds
// the screen awake for on both iOS and Android. That's the entirety of this
// screen's "keep-awake" story: it relies on the WebView's own video playback
// to hold the screen, rather than pulling in a dedicated keep-awake
// dependency, which is out of scope here (see the brief).
//
// createPlayer is an injected prop (default: the real one via a
// YouTubePlayer ref) so every bit of this — the fade math, the timer-end
// record+onEnd, the dead-video skip — is testable against a fake
// `YTPlayerLike` stub, without ever standing up a WebView (which can't run
// under Jest at all — see jest.setup.js's react-native-youtube-iframe mock).
import React, { useEffect, useRef, useState } from "react";
import { AppState, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { WebViewProps } from "react-native-webview";
import { formatTime, effectiveVolume, type Episode } from "../../vendor/player/src/lib/engine";
import { RestSession } from "../../vendor/player/src/lib/rest/session";
import { appendNight } from "../../vendor/player/src/lib/rest/ledger";
import type { RestNight } from "../../vendor/player/src/lib/rest/types";
import { getPlays, recordHeardPlay } from "../../vendor/player/src/lib/store";
import { HEARD_SEC } from "../../vendor/player/src/lib/plays";
import {
  YouTubeMedia,
  type CreatePlayerArgs,
  type YTPlayerLike,
} from "../../vendor/player/src/lib/youtube-media";
import { transportFor, shouldGiveUp, decideAfterError, nextPlayable } from "../../vendor/player/src/lib/youtube-night";
import YouTubePlayer, { type YouTubePlayerHandle } from "../youtube/YouTubePlayer";
import t from "../theme/tokens";

const FADE_SECONDS = 60;
const TICK_MS = 1000;
// How long a video may sit un-"playing" before it's given up on. Matches the
// vendor web player's own WATCHDOG_MS exactly: long enough that a
// slow-loading iframe isn't mistaken for dead, short enough that a stuck
// video doesn't eat a meaningful slice of the night in silence.
const DEAD_VIDEO_WINDOW_MS = 25_000;

// Autoplay was confirmed BLOCKED on-device without these (Task 4's link
// gate) — asking for them is a real attempt to permit it, not just a hopeful
// no-op. It still isn't guaranteed on every OS/WebView version, which is why
// yt-begin below exists as the fallback that actually works everywhere.
const WEBVIEW_PROPS: WebViewProps = {
  mediaPlaybackRequiresUserAction: false,
  allowsInlineMediaPlayback: true,
};

export interface YouTubeNightScreenProps {
  /** Tonight's spread. lineup[0] is the lead episode. */
  lineup: Episode[];
  minutes: number;
  /** Per-feed volume trim (Settings.feedTrim), folded into the fade the same
   *  way the podcast path folds it in — see effectiveVolume. */
  trim: number;
  onEnd: () => void;
  /** Injected for tests. Defaults to the real WebView-backed player via a
   *  YouTubePlayer ref. Must match CreatePlayerArgs => YTPlayerLike, the
   *  shape YouTubeMedia's constructor wants (see YouTubePlayerHandle's own
   *  doc comment for the intended wiring). */
  createPlayer?: (args: CreatePlayerArgs) => YTPlayerLike;
}

export default function YouTubeNightScreen({
  lineup,
  minutes,
  trim,
  onEnd,
  createPlayer,
}: YouTubeNightScreenProps) {
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const mediaRef = useRef<YouTubeMedia | null>(null);
  const restRef = useRef<RestSession | null>(null);
  const tickHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Props a night doesn't expect to change mid-flight, read from refs inside
  // the tick/handlers so those closures (fixed at mount — see the effect's
  // empty dep array) always see the latest value without needing to be
  // recreated.
  const lineupRef = useRef(lineup);
  const minutesRef = useRef(minutes);
  const trimRef = useRef(trim);
  const onEndRef = useRef(onEnd);
  useEffect(() => { lineupRef.current = lineup; }, [lineup]);
  useEffect(() => { minutesRef.current = minutes; }, [minutes]);
  useEffect(() => { trimRef.current = trim; }, [trim]);
  useEffect(() => { onEndRef.current = onEnd; }, [onEnd]);

  const currentEpRef = useRef<Episode | null>(null);
  const loadedAtRef = useRef(0);
  const retriesRef = useRef(0);
  // Everything known dead tonight: a video that errored permanently, or one
  // the watchdog gave up on. Excluded from pickNextEpisode's pool so a dead
  // video can't be picked right back.
  const deadRef = useRef<Set<string>>(new Set());
  // Latched true the first moment anything actually plays. Before that,
  // "unstarted" almost always means autoplay was refused — every episode
  // would refuse identically, so treating it as "dead" would burn through
  // the whole lineup and end a night having played nothing (see
  // shouldGiveUp's own doc in youtube-night.ts).
  const hasEverPlayedRef = useRef(false);
  const startedRef = useRef(false);
  const endAtRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  // The rest detector's "hidden" signal (screen off / app backgrounded),
  // tracked in a ref rather than state so tick() can read it without being a
  // render dependency — same pattern App.tsx uses for the podcast path.
  const appStateRef = useRef(AppState.currentState);
  // When the CURRENTLY LOADED episode was first observed actually playing;
  // null until then (still loading, or autoplay never got past "unstarted").
  // Reset on every loadEpisode so a skip doesn't inherit the outgoing
  // episode's play-since time.
  const epPlayingSinceRef = useRef<number | null>(null);

  const [started, setStarted] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<{ id: string; title: string } | null>(null);
  const [countdown, setCountdown] = useState(minutes * 60);
  const [volFrac, setVolFrac] = useState(1);

  // Records the outgoing episode's heard time into the plays ledger — the
  // same ledger pickNextEpisode reads, so an episode heard past HEARD_SEC
  // this session won't immediately get handed right back on the next skip,
  // and RestScreen's "last night" has something to show for a YouTube night.
  // Idempotent (nulls epPlayingSinceRef itself) so it's safe to call from
  // both loadEpisode (outgoing episode, mid-night) and endNight (whatever
  // was still current when the night ended) without double-recording.
  function flushHeard(now: number) {
    const ep = currentEpRef.current;
    const since = epPlayingSinceRef.current;
    epPlayingSinceRef.current = null;
    if (!ep || since === null) return;
    const heardSec = Math.round((now - since) / 1000);
    if (heardSec >= HEARD_SEC) {
      recordHeardPlay({ id: ep.id, title: ep.title, feedId: ep.feedId, startedAt: since, heardSec });
    }
  }

  function loadEpisode(ep: Episode) {
    flushHeard(Date.now());
    currentEpRef.current = ep;
    loadedAtRef.current = Date.now();
    retriesRef.current = 0;
    setNowPlaying({ id: ep.id, title: ep.title });
    if (ep.youtubeId) mediaRef.current?.load(ep.youtubeId, 0);
  }

  // The one place "what plays after this" is decided, shared by all three
  // ways a video stops being viable: it errored past its retry budget, it
  // played to the end, or the watchdog gave up on it. A night with nothing
  // left to play ends rather than sitting on a black frame with the
  // countdown running — see the module doc.
  //
  // nextPlayable (not a hand-rolled dead-filter + pickNextEpisode) does two
  // things a naive pick doesn't: it excludes the OUTGOING episode itself —
  // not just the dead set — so an episode that just played to the end
  // (handleEnded, nothing wrong with it, never added to deadRef) can't be
  // handed straight back; and it falls back to allowing a repeat only when
  // that outgoing episode is the sole survivor, rather than ending the night
  // over a technicality. flushHeard runs first so the just-finished
  // episode's heard time is in the ledger nextPlayable's pickNextEpisode
  // reads before that pick happens, not after.
  function skipToNext() {
    if (endedRef.current) return;
    const outgoingId = currentEpRef.current?.id ?? null;
    flushHeard(Date.now());
    const next = nextPlayable(lineupRef.current, deadRef.current, outgoingId, getPlays());
    if (!next) {
      endNight("ended");
      return;
    }
    loadEpisode(next);
  }

  function handleEnded() {
    if (endedRef.current) return;
    skipToNext();
  }

  function handleError(code: number) {
    if (endedRef.current) return;
    const ep = currentEpRef.current;
    if (!ep) return;
    const decision = decideAfterError(code, retriesRef.current);
    if (decision.action === "retry") {
      retriesRef.current++;
      loadedAtRef.current = Date.now();
      if (ep.youtubeId) mediaRef.current?.load(ep.youtubeId, 0);
      return;
    }
    deadRef.current.add(ep.id);
    skipToNext();
  }

  function endNight(reason: RestNight["endedVia"]) {
    if (endedRef.current) return;
    endedRef.current = true;
    flushHeard(Date.now());
    if (tickHandleRef.current !== null) {
      clearInterval(tickHandleRef.current);
      tickHandleRef.current = null;
    }
    mediaRef.current?.destroy();
    mediaRef.current = null;
    if (restRef.current) {
      appendNight(restRef.current.finish(reason, Date.now()));
      restRef.current = null;
    }
    onEndRef.current();
  }

  function tick() {
    if (endedRef.current) return;
    const media = mediaRef.current;
    if (!media) return;
    const now = Date.now();
    const state = media.state();
    const transport = transportFor(state);
    if (transport === "playing") {
      hasEverPlayedRef.current = true;
      if (epPlayingSinceRef.current === null) epPlayingSinceRef.current = now;
    }

    const cur = currentEpRef.current;
    if (
      cur &&
      shouldGiveUp({
        state,
        hasEverPlayed: hasEverPlayedRef.current,
        elapsedMs: now - loadedAtRef.current,
        limitMs: DEAD_VIDEO_WINDOW_MS,
      })
    ) {
      deadRef.current.add(cur.id);
      skipToNext();
      return;
    }

    if (!startedRef.current) {
      // The clock (and the fade) don't start until something is actually
      // playing — autoplay is blocked on-device, so a night whose timer ran
      // from mount would spend real minutes on a tap-to-begin overlay.
      if (transport !== "playing") return;
      startedRef.current = true;
      setStarted(true);
      endAtRef.current = now + minutesRef.current * 60_000;
      // Anchored at the moment playback is actually observed, not at mount
      // — a slow tap-to-begin would otherwise report a false head start to
      // the sleep detector. Mirrors App.tsx's beginPlayback, which likewise
      // only ever constructs a RestSession once playback has genuinely
      // begun (there it's immediate; here it can be delayed by the tap).
      restRef.current = new RestSession(now, minutesRef.current);
    }

    const endAt = endAtRef.current;
    if (endAt === null) return;
    const remaining = (endAt - now) / 1000;
    if (remaining <= 0) {
      endNight("faded");
      return;
    }

    // Purely observational, same as the podcast path: fed the current
    // state so the sleep detector can do its job, but nothing here acts on
    // its return value — only the timer (above) and the transport buttons
    // ever end or shorten a night.
    restRef.current?.tick({
      now,
      hidden: appStateRef.current !== "active",
      fadingOrDone: remaining <= FADE_SECONDS,
    });

    setCountdown(remaining);
    const vol = effectiveVolume(remaining, FADE_SECONDS, trimRef.current);
    setVolFrac(vol);
    // YouTubeMedia.setVolume takes 0-1 (like HTMLMediaElement.volume) and
    // does the round-to-percent conversion itself before handing the player
    // its 0-100 scale — see youtube-media.ts. Passing the raw fraction here
    // (rather than pre-multiplying) reuses that conversion instead of
    // duplicating it, same as the vendor web player does.
    media.setVolume(vol);
  }

  function handleBegin() {
    restRef.current?.noteInteraction();
    mediaRef.current?.play();
  }

  function handleStop() {
    endNight("abandoned");
  }

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => { appStateRef.current = next; });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const cp = createPlayer ?? ((args: CreatePlayerArgs) => playerRef.current!.createPlayer(args));
    const media = new YouTubeMedia(cp, {
      onEnded: () => handleEnded(),
      onError: (code) => handleError(code),
    });
    mediaRef.current = media;
    // restRef is deliberately NOT constructed here — see tick()'s
    // started-gate, which anchors it at the moment playback actually begins.

    const first = lineupRef.current[0] ?? null;
    if (!first || !first.youtubeId) {
      // Nothing playable at all — end immediately rather than rendering a
      // silent black rectangle for the rest of the night.
      endNight("ended");
    } else {
      loadEpisode(first);
      // A best-effort autoplay attempt. WEBVIEW_PROPS above is the real
      // attempt at permitting it; this call is safe either way — if the OS
      // still refuses, the video sits at "unstarted" and yt-begin is the
      // fallback (see the render below and shouldGiveUp's unstarted-before-
      // played exemption, which is exactly what stops that wait from being
      // mistaken for a dead video).
      media.play();
    }

    tickHandleRef.current = setInterval(tick, TICK_MS);

    return () => {
      if (tickHandleRef.current !== null) clearInterval(tickHandleRef.current);
      tickHandleRef.current = null;
      mediaRef.current?.destroy();
      mediaRef.current = null;
    };
    // Mount-only: minutes/trim/lineup/onEnd/createPlayer are read through
    // refs (or, for createPlayer, only ever needed once) rather than as
    // effect deps, so this doesn't re-run — and can't accidentally build a
    // second YouTubeMedia/RestSession — if the parent re-renders mid-night.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={s.body} testID="yt-root">
      {/* The video stays on screen — hiding Google's embedded player is
          against the terms this feature depends on. It also has to keep
          rendering for the screen-on assumption above to hold. */}
      <View style={s.playerWrap}>
        <YouTubePlayer ref={playerRef} webViewProps={WEBVIEW_PROPS} />
      </View>
      <Text style={s.moon} accessibilityElementsHidden={true} importantForAccessibility="no-hide-descendants">☾</Text>
      <Text style={s.title} testID="yt-nowplaying" numberOfLines={2} accessibilityRole="header">
        {nowPlaying?.title ?? ""}
      </Text>
      <Text style={s.dim} testID="yt-countdown" accessibilityLabel={`${Math.floor(countdown / 60)} minutes ${Math.round(countdown % 60)} seconds remaining`}>{formatTime(countdown)}</Text>
      <Text style={s.dim} testID="yt-volume" accessibilityLabel={`volume ${Math.round(volFrac * 100)} percent`}>vol {volFrac.toFixed(2)}</Text>
      <TouchableOpacity style={s.btn} testID="yt-stop" onPress={handleStop} accessibilityRole="button" accessibilityLabel="stop">
        <Text style={s.btnT}>stop</Text>
      </TouchableOpacity>
      {/* Design-mandated: the screen-on limitation (see the module doc — a
          locked screen stops WebView playback outright, with no API to
          change that) has to be said plainly here, not left implicit. */}
      <Text style={s.note} testID="yt-screen-note">screen stays on for YouTube</Text>
      {!started && (
        <TouchableOpacity style={s.beginBtn} testID="yt-begin" onPress={handleBegin} accessibilityRole="button" accessibilityLabel="start playback">
          <Text style={s.beginT}>tap to begin</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const androidStyles = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 24 },
  playerWrap: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, overflow: "hidden" },
  moon: { fontSize: 40, color: "#f0dcb8" },
  title: { color: "#c8c0b0", fontSize: 16, textAlign: "center" },
  dim: { color: "#9a875f", fontSize: 13 },
  note: { color: "#6f6a62", fontSize: 11 },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  btnT: { color: "#d9c9a8", fontSize: 14 },
  beginBtn: {
    position: "absolute",
    top: "20%",
    borderWidth: 1,
    borderColor: "#9a875f",
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: "#050508",
  },
  beginT: { color: "#f0dcb8", fontSize: 14 },
});

const iosStyles = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: t.space(4.5), padding: t.space(6) },
  playerWrap: { width: "100%", aspectRatio: 16 / 9, borderRadius: t.radius.sm, overflow: "hidden" },
  moon: { fontSize: 40, color: t.color.textPrimary },
  title: { color: t.color.textSecondary, ...t.type.heading, textAlign: "center" },
  dim: { color: t.color.label, ...t.type.label, ...t.tabular },
  note: { color: t.color.textMuted, fontSize: 11 },
  btn: { borderWidth: 1, borderColor: t.color.hairline, borderRadius: t.radius.pill, paddingHorizontal: t.space(5), paddingVertical: t.space(2.5), minHeight: 44, alignItems: "center", justifyContent: "center" },
  btnT: { color: t.color.textPrimary, ...t.type.bodySm },
  beginBtn: {
    position: "absolute",
    top: "20%",
    borderWidth: 1,
    borderColor: t.color.label,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.space(6),
    paddingVertical: t.space(3),
    backgroundColor: t.color.ground,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  beginT: { color: t.color.textPrimary, ...t.type.bodySm },
});

const s = t.ios ? iosStyles : androidStyles;
