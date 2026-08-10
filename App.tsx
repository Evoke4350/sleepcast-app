import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, StatusBar, StyleSheet, Text, View } from "react-native";
// Not react-native's SafeAreaView, which is deprecated in 0.86 and warns on
// every render. react-native-safe-area-context was already a dependency here;
// the import was simply pointing at the wrong one.
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { installLocalStorage } from "./src/platform/storage";
import { buildPool } from "./src/platform/feeds";
import { chooseLineup, resumeNight, type Strategy } from "./src/logic/selection";
import { saveMarker, loadMarker, clearMarker, reconcileToLastNight } from "./src/logic/nightmarker";
import { getNightAudio } from "./src/specs/NativeNightAudio";
import { effectiveVolume } from "./vendor/player/src/lib/engine";
import { RestSession } from "./vendor/player/src/lib/rest/session";
import { appendNight, loadQuietUntil } from "./vendor/player/src/lib/rest/ledger";
import { isQuiet } from "./vendor/player/src/lib/rest/stepback";
import { shouldSuggestGettingUp } from "./vendor/player/src/lib/rest/quarterhour";
import { recordHeardPlay, saveLastNight, loadTimerMinutes, loadLastNight, loadState, getPlays } from "./vendor/player/src/lib/store";
import { HEARD_SEC } from "./vendor/player/src/lib/plays";
import type { Episode } from "./vendor/player/src/lib/engine";
import { isYouTubeLineup, nextPlayable } from "./vendor/player/src/lib/youtube-night";
import SetupScreen, { ALL_NIGHT, isAllNightSelected } from "./src/screens/SetupScreen";
import PlayerScreen from "./src/screens/PlayerScreen";
import RestScreen from "./src/screens/RestScreen";
import GettingUpScreen from "./src/screens/GettingUpScreen";
import YouTubeNightScreen from "./src/screens/YouTubeNightScreen";
import { YOUTUBE } from "./src/features";

// Must run before anything touches the shared code, which reads localStorage
// synchronously at module scope in places.
installLocalStorage();

const FADE_SECONDS = 60;
// A stand-in "night length" for all-night mode: fed to RestSession and the
// reconcile marker (which caps heard time by it) so a killed all-night night
// reconciles the current episode without a real timer. 10 hours covers a night.
const ALL_NIGHT_CAP_MIN = 600;
// An episode must have played at least this long before a natural end triggers
// the all-night advance/replay — a floor against a pathological feed of
// instantly-ending items spinning the auto-advance (CPU/battery all night).
const MIN_TRACK_MS = 2_000;
const nativeFetch = (url: string) => fetch(url).then((r) => r.text());

export default function App() {
  const [pool, setPool] = useState<Episode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Episode | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [volume, setVolume] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [showRest, setShowRest] = useState(false);
  const [gettingUp, setGettingUp] = useState(false);
  // True when a night is playing but the listener has gone back to the home
  // (setup) screen. Playback keeps running (native foreground service); this
  // only changes which screen is mounted. Reset whenever a night starts or ends.
  const [atHome, setAtHome] = useState(false);
  // Whether the live night is all-night (no timer). Drives the "all night"
  // display; the logic paths key off endAtRef.current === null.
  const [allNight, setAllNight] = useState(false);
  // A YouTube-lead lineup never touches beginPlayback/PlayerScreen — the
  // native fade/stop timer is a podcast-only concept (WebView playback is
  // opaque to native). Set instead of started, this routes straight to
  // YouTubeNightScreen, which owns its own JS-driven fade/timer/skip. Cleared
  // back to setup by that screen's onEnd.
  const [ytSession, setYtSession] = useState<{ lineup: Episode[]; minutes: number; trim: number } | null>(null);

  const endAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Two clocks: `startedAtRef` is the CURRENT episode's start (reset on a skip,
  // drives per-episode heard accounting), while `nightStartedAtRef` is the whole
  // night's start (never reset), which the quarter-hour rule and the reconcile
  // marker's night length key off — a skip must not defeat either.
  const startedAtRef = useRef(0);
  const nightStartedAtRef = useRef(0);
  const skippingRef = useRef(false);
  const lineupRef = useRef<Episode[]>([]);
  const variedRef = useRef(false);
  const nowRef = useRef<Episode | null>(null);
  const playedIdsRef = useRef<string[]>([]);
  const feedTitlesRef = useRef<Record<string, string>>({});
  const restRef = useRef<RestSession | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const trimRef = useRef(1);
  // Opt-in quarter-hour rule (see vendor rest/quarterhour.ts): read fresh from
  // settings at play time into a ref (not state) so the 1s interval can check
  // it without becoming a render dependency, and latched so it can fire at
  // most once per night even though the interval keeps ticking afterward.
  const quarterHourRef = useRef(false);
  const ruleSpentRef = useRef(false);

  // If the OS killed the process mid-night, onNightEnded never fired and the
  // ledger was never written. A marker persisted at play time (see
  // beginPlayback) survives that death; on the next launch, if native
  // confirms nothing is currently playing, reconstruct the ledger as if the
  // night had faded normally so resume-after-fade still works.
  //
  // getNightAudio() can return null for a beat after mount (same TurboModule
  // registration race the onNightEnded-subscription effect below retries
  // for). Treating "module not ready" as "not playing" would falsely
  // reconcile a night that is actually still in progress, and the real
  // onNightEnded that fires moments later would then double-write the
  // ledger via finishNight. So: retry until the module resolves, and only
  // ever reconcile on a CONFIRMED not-playing answer. If the module never
  // resolves within the retry window, we simply don't reconcile — safer to
  // leave a stale marker for next launch than to guess wrong.
  useEffect(() => {
    const marker = loadMarker();
    if (!marker) return;
    let id: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;
    const tryReconcile = () => {
      const audio = getNightAudio();
      if (!audio) return false; // module not ready yet — keep waiting
      void Promise.resolve(audio.isPlaying?.()).then((playing) => {
        if (!playing) reconcileToLastNight(marker, Date.now());
      });
      return true;
    };
    if (!tryReconcile()) {
      id = setInterval(() => {
        attempts += 1;
        if (tryReconcile() || attempts >= 15) { if (id) { clearInterval(id); id = null; } } // ~3s cap
      }, 200);
    }
    return () => { if (id) clearInterval(id); };
  }, []);

  // The rest detector's "hidden" signal (screen off / app backgrounded) comes
  // from AppState, tracked in a ref rather than state so the 1s tick below
  // can read it without becoming a render dependency itself.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { appStateRef.current = s; });
    return () => sub.remove();
  }, []);

  // The pool is (re)built from the currently enabled feeds. It must be rebuilt
  // whenever the user changes which feeds are enabled — not only at mount —
  // otherwise enabling a second feed never reaches the mix (SetupScreen calls
  // this via onFeedsChanged).
  const refreshPool = useCallback((initial = false) => {
    return buildPool(nativeFetch)
      .then(({ pool: builtPool, feedTitles, errors }) => {
        if (!builtPool.length) {
          // First load with no episodes is a real error to surface; a later
          // refresh keeps the working pool rather than blanking a running app.
          if (initial) throw new Error(errors[0] ?? "no episodes");
          return;
        }
        feedTitlesRef.current = feedTitles;
        setPool(builtPool);
        setError(null);
      })
      .catch((e) => { if (initial) setError(String(e?.message ?? e)); });
  }, []);

  useEffect(() => {
    refreshPool(true);
    return () => stopTick();
  }, [refreshPool]);

  // Native is authoritative now: it runs the fade/stop timer even while JS is
  // suspended (screen locked), then tells us it happened. This is where the
  // ledger bookkeeping actually lives.
  //
  // getNightAudio() can return null for a beat after mount if the TurboModule
  // registry isn't ready yet (see NativeNightAudio.ts's own comment on lazy
  // resolution). A one-shot subscribe attempt would permanently miss
  // onNightEnded in that case, so retry on a short interval until it lands.
  useEffect(() => {
    let sub: { remove?: () => void } | undefined;
    let sub2: { remove?: () => void } | undefined;
    let id: ReturnType<typeof setInterval> | null = null;
    const trySubscribe = () => {
      const audio = getNightAudio();
      if (!audio) return false;
      sub = audio.onNightEnded((e) => { void onNightEnded(e.episodeId, e.heardSeconds); });
      // All-night auto-advance: when a track finishes on its own, move to the
      // next pick. onTrackEnded fires on every night; onTrackEndedNatural gates
      // it to all-night (timed nights let the fade timer own the ending).
      // Guarded: a JS bundle newer than the installed native binary (a dev
      // reload against an old build) would otherwise crash here on an undefined
      // event — degrade to "no auto-advance" instead.
      if (typeof audio.onTrackEnded === "function") {
        sub2 = audio.onTrackEnded(() => { void onTrackEndedNatural(); });
      }
      return true;
    };
    if (!trySubscribe()) {
      id = setInterval(() => { if (trySubscribe() && id) { clearInterval(id); id = null; } }, 200);
    }
    return () => { if (id) clearInterval(id); sub?.remove?.(); sub2?.remove?.(); };
  }, []);

  function stopTick() {
    if (tickRef.current !== null) clearInterval(tickRef.current);
    tickRef.current = null;
  }

  // The single place that writes the "a night ended" ledger entry, shared by
  // both ways a night can end: native's onNightEnded (faded) and a manual
  // stop (abandoned). Keeping this in one function means the record-heard →
  // append-playedIds → save-last-night → reset-state sequence can't drift
  // between the two callers.
  function finishNight(ep: Episode | null, heardSec: number, endedVia: "faded" | "abandoned") {
    stopTick();
    endAtRef.current = null;
    // The night ended cleanly through this function (either onNightEnded or
    // a manual stop), so the live marker's job is done — clear it before the
    // process can die in a way that would leave both the marker AND this
    // ledger write around to be double-reconciled on the next launch.
    clearMarker();
    if (ep) {
      // The ledger only counts what was actually heard, whether the night
      // faded out or was stopped by hand.
      if (heardSec >= HEARD_SEC) {
        recordHeardPlay({ id: ep.id, title: ep.title, feedId: ep.feedId, startedAt: startedAtRef.current, heardSec });
      }
      if (!playedIdsRef.current.includes(ep.id)) playedIdsRef.current = [...playedIdsRef.current, ep.id];
      saveLastNight({
        pool: lineupRef.current, playedIds: playedIdsRef.current,
        feedTitles: feedTitlesRef.current, artworkByFeedId: {}, skipIntroByFeedId: {},
        endedVia, endedAt: Date.now(), wasVaried: variedRef.current,
      });
    }
    // The rest detector is purely observational — it never influenced when or
    // how this night ended, it only watched. Finish and record it here so
    // every ended night (faded or abandoned) gets exactly one ledger entry,
    // through this single funnel.
    if (restRef.current) {
      appendNight(restRef.current.finish(endedVia, Date.now()));
      restRef.current = null;
    }
    nowRef.current = null;
    setPlaying(false); setNow(null); setRemaining(0); setVolume(1);
    setAtHome(false); setAllNight(false); // a finished night leaves home clean
  }

  async function endSession() {
    getNightAudio()?.cancelTimer();
    getNightAudio()?.stop();
    const heardSec = Math.round((Date.now() - startedAtRef.current) / 1000);
    finishNight(nowRef.current, heardSec, "abandoned");
  }

  // The bookkeeping that used to live in the JS interval's left<=0 branch.
  // Now it's triggered by native's onNightEnded event, so it runs whether or
  // not JS was awake when the timer actually reached zero.
  async function onNightEnded(episodeId: string, heardSeconds: number) {
    // No live night in THIS JS instance (e.g. JS reloaded under a surviving
    // native timer): bail before finishNight can clear the reconcile marker
    // while writing nothing — the marker is the only remaining record of the
    // night, and the next-launch reconcile will turn it into the ledger entry.
    if (endAtRef.current === null) return;
    const ep = nowRef.current; // single-lead night: the current episode is the one that ended
    finishNight(ep, heardSeconds, "faded");
  }

  // Opt-in stimulus control: if the listener has been restless-and-fiddling for
  // ~25 minutes, stop the night (same path a manual stop takes) and suggest
  // getting up. Latched via ruleSpentRef so it can only ever fire once. Elapsed
  // is measured from the NIGHT start (not the current episode) so a serial
  // skipper can't keep resetting the clock. Runs for timed AND all-night nights.
  function checkQuarterHour(now: number) {
    if (quarterHourRef.current && !ruleSpentRef.current && restRef.current) {
      const w = restRef.current.wakefulness(now);
      if (shouldSuggestGettingUp({ elapsedMs: now - nightStartedAtRef.current, ...w })) {
        ruleSpentRef.current = true;
        setGettingUp(true);
        endSession();
      }
    }
  }

  async function beginPlayback(lead: Episode, minutes: number) {
    const allNightMode = minutes === ALL_NIGHT;
    setAllNight(allNightMode);
    setNow(lead);
    setAtHome(false); // a freshly started night opens the player
    nowRef.current = lead;
    startedAtRef.current = Date.now();
    nightStartedAtRef.current = startedAtRef.current;
    // All-night has no scheduled end (endAtRef null); the fade/stop timer is
    // simply never armed and the tick skips the countdown for it.
    endAtRef.current = allNightMode ? null : Date.now() + minutes * 60_000;
    restRef.current = new RestSession(startedAtRef.current, allNightMode ? ALL_NIGHT_CAP_MIN : minutes);
    quarterHourRef.current = loadState().settings.quarterHourRule && !isQuiet(loadQuietUntil(), Date.now());
    ruleSpentRef.current = false;
    // Metadata first: it has to be on the MediaItem when playback starts, or
    // the lock screen shows nothing and setting it later restarts the audio.
    getNightAudio()?.setNowPlaying(lead.title, "sleepcast", "", 0);
    await getNightAudio()?.play(lead.url, 0);
    // The feed's volume trim (Settings.feedTrim, defaulting to 1) travels with
    // playback. For a timed night native owns the fade/stop; for all-night there
    // is no timer, so just set the trimmed level once.
    trimRef.current = loadState().settings.feedTrim[lead.feedId] ?? 1;
    if (allNightMode) {
      getNightAudio()?.setVolume(trimRef.current);
    } else {
      getNightAudio()?.scheduleFadeAndStop(lead.id, minutes * 60, FADE_SECONDS, trimRef.current);
    }
    // Persist a "live night" marker so a killed process can be reconciled on
    // the next launch. All-night uses a large cap so the reconcile heard-cap is
    // effectively "elapsed since this episode started".
    const markerMinutes = allNightMode ? ALL_NIGHT_CAP_MIN : minutes;
    saveMarker({
      episodeId: lead.id, startedAt: startedAtRef.current, timerMinutes: markerMinutes, nightMinutes: markerMinutes,
      lineup: lineupRef.current, playedIds: playedIdsRef.current,
      feedTitles: feedTitlesRef.current, wasVaried: variedRef.current,
    });
    setShowRest(false);
    setPlaying(true);

    stopTick();
    tickRef.current = setInterval(() => {
      if (!nowRef.current) return; // no live night to observe
      const now = Date.now();
      const end = endAtRef.current;
      if (end === null) {
        // All-night: still observe the rest detector and honor the quarter-hour
        // rule, but there's no countdown/fade to reflect.
        restRef.current?.tick({ now, hidden: appStateRef.current !== "active", fadingOrDone: false });
        checkQuarterHour(now);
        return;
      }
      const left = (end - now) / 1000;
      if (left <= 0) { stopTick(); return; } // native performs the actual stop
      // Purely observational: fed the current state, its return value is
      // ignored here. Native (via onNightEnded/finishNight) is the only thing
      // that ever ends or shortens a night — this only ever watches one.
      restRef.current?.tick({ now, hidden: appStateRef.current !== "active", fadingOrDone: left <= FADE_SECONDS });
      // The same fade curve (and per-feed trim) the web player uses, purely to
      // reflect native's countdown/volume in the UI while foregrounded.
      setVolume(effectiveVolume(left, FADE_SECONDS, trimRef.current));
      setRemaining(left);
      checkQuarterHour(now);
    }, 1000);
  }

  // Replay the current episode from the top (all-night, when there's no other
  // pick to advance to — e.g. a single-episode shuffle lineup). Without this the
  // lone episode would end and the night would go silent, the exact thing
  // all-night exists to prevent.
  async function replayCurrent() {
    const cur = nowRef.current;
    if (!cur || skippingRef.current) return;
    skippingRef.current = true;
    try {
      const nowMs = Date.now();
      const heardSec = Math.round((nowMs - startedAtRef.current) / 1000);
      if (heardSec >= HEARD_SEC) {
        recordHeardPlay({ id: cur.id, title: cur.title, feedId: cur.feedId, startedAt: startedAtRef.current, heardSec });
      }
      startedAtRef.current = nowMs;
      getNightAudio()?.setNowPlaying(cur.title, "sleepcast", "", 0);
      await getNightAudio()?.play(cur.url, 0);
      getNightAudio()?.setVolume(trimRef.current);
    } finally {
      skippingRef.current = false;
    }
  }

  // Natural end-of-track (native onTrackEnded). Auto-advance only in all-night
  // mode; a timed night lets the fade timer own the ending (unchanged behavior).
  function onTrackEndedNatural() {
    const cur = nowRef.current;
    if (!cur || endAtRef.current !== null) return;
    // Floor against a feed of instantly-ending items spinning the advance.
    if (Date.now() - startedAtRef.current < MIN_TRACK_MS) return;
    const next = nextPlayable(lineupRef.current, new Set<string>(), cur.id, getPlays());
    // A single-episode lineup (shuffle) makes nextPlayable return the current
    // one; replay it rather than no-op into silence.
    if (next && next.id !== cur.id) void skipTo(next);
    else void replayCurrent();
  }

  // Switch the current episode mid-night without changing when the night
  // ends. The night's fade/stop is fixed by endAtRef; skipping re-arms the
  // native timer for the REMAINING time with the new feed's trim, so the night
  // still fades and stops at the same wall-clock moment. Night-level state
  // (endAtRef, restRef, quarterHourRef, the tick) is untouched — only the
  // per-episode clock (startedAtRef), the current episode, and the trim change.
  async function skipTo(ep: Episode) {
    const cur = nowRef.current;
    if (!cur || ep.id === cur.id) return;
    // One skip at a time: skipTo awaits play(), and the row/next controls stay
    // live during that await. Without this, two quick taps interleave and the
    // armed episode / persisted marker can disagree with the audio playing.
    if (skippingRef.current) return;
    skippingRef.current = true;
    try {
      const nowMs = Date.now();
      // Cancel the OLD episode's native timer up front — before the play()
      // await — so a late skip (final seconds) can't have the old timer fire
      // onNightEnded and tear the night down while we're mid-re-arm. Harmless
      // in all-night mode (no timer running).
      getNightAudio()?.cancelTimer();
      // Count the outgoing episode the same way finishNight does, so a skipped-
      // away episode still lands in the ledger and won't be re-offered.
      const heardSec = Math.round((nowMs - startedAtRef.current) / 1000);
      if (heardSec >= HEARD_SEC) {
        recordHeardPlay({ id: cur.id, title: cur.title, feedId: cur.feedId, startedAt: startedAtRef.current, heardSec });
      }
      if (!playedIdsRef.current.includes(cur.id)) playedIdsRef.current = [...playedIdsRef.current, cur.id];

      setNow(ep);
      nowRef.current = ep;
      startedAtRef.current = nowMs; // per-episode heard clock; night start is untouched
      trimRef.current = loadState().settings.feedTrim[ep.feedId] ?? 1;
      getNightAudio()?.setNowPlaying(ep.title, "sleepcast", "", 0);
      await getNightAudio()?.play(ep.url, 0);
      // Re-arm a fade/stop only for a TIMED night, for the REMAINING time; an
      // all-night night has no timer, so just set the trimmed level.
      const end = endAtRef.current;
      if (end !== null) {
        const remainingSec = Math.max(0, Math.round((end - nowMs) / 1000));
        getNightAudio()?.scheduleFadeAndStop(ep.id, remainingSec, FADE_SECONDS, trimRef.current);
      } else {
        getNightAudio()?.setVolume(trimRef.current);
      }
      // Re-point the reconcile marker at the episode actually playing now: its
      // own (shortened) remaining window for the heard cap, plus the full night
      // length (a large cap for all-night) so a killed night reconciles right.
      const markerMinutes = end !== null ? Math.round((end - nowMs) / 60_000) : ALL_NIGHT_CAP_MIN;
      const nightMins = end !== null ? Math.round((end - nightStartedAtRef.current) / 60_000) : ALL_NIGHT_CAP_MIN;
      saveMarker({
        episodeId: ep.id, startedAt: startedAtRef.current,
        timerMinutes: markerMinutes, nightMinutes: nightMins,
        lineup: lineupRef.current, playedIds: playedIdsRef.current,
        feedTitles: feedTitlesRef.current, wasVaried: variedRef.current,
      });
    } finally {
      skippingRef.current = false;
    }
  }

  // The "next" control: advance to another pick in the lineup (prefers one
  // other than the current, weighted away from recently-played), reusing the
  // vendor selector. No "dead" set — podcast episodes don't get culled the way
  // YouTube ones can.
  function skipToNext() {
    const nextEp = nextPlayable(lineupRef.current, new Set<string>(), nowRef.current?.id ?? null, getPlays());
    if (nextEp) void skipTo(nextEp);
  }

  async function onStart(strategy: Strategy, minutes: number) {
    if (!pool) return;
    const r = await chooseLineup(strategy, pool);
    if (!r) return;
    // Starting from home while a night is live replaces it: abandon the current
    // one through the same funnel a manual stop uses, then begin the new night.
    if (nowRef.current) endSession();
    lineupRef.current = r.lineup;
    playedIdsRef.current = [];
    variedRef.current = r.wasVaried;
    if (YOUTUBE && isYouTubeLineup([r.lead])) {
      const trim = loadState().settings.feedTrim[r.lead.feedId] ?? 1;
      setYtSession({ lineup: r.lineup, minutes, trim });
      return;
    }
    await beginPlayback(r.lead, minutes);
  }

  async function onResume() {
    const last = loadLastNight();
    const r = resumeNight(loadTimerMinutes());
    if (!last || !r) return;
    if (nowRef.current) endSession(); // replace any live night (see onStart)
    lineupRef.current = last.pool;
    playedIdsRef.current = [...last.playedIds];
    variedRef.current = last.wasVaried;
    // Currently unreachable: YouTubeNightScreen never calls saveLastNight,
    // so `last` (from loadLastNight()) can never be a YouTube-lead night —
    // resume-after-fade for YouTube is deferred. Kept for when it lands,
    // rather than left to silently do the wrong thing if it does. Gated on
    // YOUTUBE so the foss build can never route here if it ever becomes reachable.
    if (YOUTUBE && isYouTubeLineup([r.lead])) {
      const trim = loadState().settings.feedTrim[r.lead.feedId] ?? 1;
      setYtSession({ lineup: last.pool, minutes: r.minutes, trim });
      return;
    }
    // All-night can't ride in loadTimerMinutes (the vendor store clamps -1), so
    // resume keeps all-night when that's the selected mode instead of silently
    // starting a short timed night.
    await beginPlayback(r.lead, isAllNightSelected() ? ALL_NIGHT : r.minutes);
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor="#050508" />
        {error ? (
          <View style={s.center}><Text style={s.err} testID="error">{error}</Text></View>
        ) : pool === null ? (
          <View style={s.center}>
            <ActivityIndicator color="#6e5d44" />
            <Text style={s.dim} testID="status">gathering episodes…</Text>
          </View>
        ) : gettingUp ? (
          <GettingUpScreen onDismiss={() => setGettingUp(false)} />
        ) : ytSession ? (
          <YouTubeNightScreen
            lineup={ytSession.lineup}
            minutes={ytSession.minutes}
            trim={ytSession.trim}
            onEnd={() => setYtSession(null)}
          />
        ) : playing && now && !atHome ? (
          <PlayerScreen
            title={now.title} remaining={remaining} volume={volume} allNight={allNight}
            lineup={lineupRef.current} currentId={now.id} feedTitles={feedTitlesRef.current}
            onSelect={(ep) => skipTo(ep)} onNext={skipToNext} onHome={() => setAtHome(true)}
            onStop={() => endSession()} onInteract={() => restRef.current?.noteInteraction()} />
        ) : showRest ? (
          <RestScreen onClose={() => setShowRest(false)} />
        ) : (
          <SetupScreen
            onStart={onStart} onResume={onResume}
            resumeAvailable={!!resumeNight(loadTimerMinutes()) && !isQuiet(loadQuietUntil(), Date.now())}
            onOpenRest={() => setShowRest(true)}
            nowPlaying={playing && now ? { title: now.title, remaining, allNight } : undefined}
            onReturnToPlayer={() => setAtHome(false)}
            onFeedsChanged={() => refreshPool()} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050508" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 24 },
  dim: { color: "#6e5d44", fontSize: 13 },
  err: { color: "#b3746b", fontSize: 13, textAlign: "center" },
});
