import React, { useEffect, useRef, useState } from "react";
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
import { appendNight } from "./vendor/player/src/lib/rest/ledger";
import { recordHeardPlay, saveLastNight, loadTimerMinutes, loadLastNight, loadState } from "./vendor/player/src/lib/store";
import { HEARD_SEC } from "./vendor/player/src/lib/plays";
import type { Episode } from "./vendor/player/src/lib/engine";
import SetupScreen from "./src/screens/SetupScreen";
import PlayerScreen from "./src/screens/PlayerScreen";
import RestScreen from "./src/screens/RestScreen";

// Must run before anything touches the shared code, which reads localStorage
// synchronously at module scope in places.
installLocalStorage();

const FADE_SECONDS = 60;
const nativeFetch = (url: string) => fetch(url).then((r) => r.text());

export default function App() {
  const [pool, setPool] = useState<Episode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Episode | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [volume, setVolume] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [showRest, setShowRest] = useState(false);

  const endAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const lineupRef = useRef<Episode[]>([]);
  const variedRef = useRef(false);
  const nowRef = useRef<Episode | null>(null);
  const playedIdsRef = useRef<string[]>([]);
  const feedTitlesRef = useRef<Record<string, string>>({});
  const restRef = useRef<RestSession | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const trimRef = useRef(1);

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

  useEffect(() => {
    buildPool(nativeFetch)
      .then(({ pool: builtPool, feedTitles, errors }) => {
        if (!builtPool.length) throw new Error(errors[0] ?? "no episodes");
        feedTitlesRef.current = feedTitles;
        setPool(builtPool);
      })
      .catch((e) => setError(String(e?.message ?? e)));
    return () => stopTick();
  }, []);

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
    let id: ReturnType<typeof setInterval> | null = null;
    const trySubscribe = () => {
      const audio = getNightAudio();
      if (!audio) return false;
      sub = audio.onNightEnded((e) => { void onNightEnded(e.episodeId, e.heardSeconds); });
      return true;
    };
    if (!trySubscribe()) {
      id = setInterval(() => { if (trySubscribe() && id) { clearInterval(id); id = null; } }, 200);
    }
    return () => { if (id) clearInterval(id); sub?.remove?.(); };
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

  async function beginPlayback(lead: Episode, minutes: number) {
    setNow(lead);
    nowRef.current = lead;
    startedAtRef.current = Date.now();
    endAtRef.current = Date.now() + minutes * 60_000;
    restRef.current = new RestSession(startedAtRef.current, minutes);
    // Metadata first: it has to be on the MediaItem when playback starts, or
    // the lock screen shows nothing and setting it later restarts the audio.
    getNightAudio()?.setNowPlaying(lead.title, "sleepcast", "", 0);
    await getNightAudio()?.play(lead.url, 0);
    // Native now owns the fade/stop: it keeps running even if the screen
    // locks and JS timers suspend. It reports back via onNightEnded. The
    // feed's volume trim (Settings.feedTrim, defaulting to 1) has to travel
    // with it so native can fold it into the volume it drives all night, not
    // just during the fade window.
    trimRef.current = loadState().settings.feedTrim[lead.feedId] ?? 1;
    getNightAudio()?.scheduleFadeAndStop(lead.id, minutes * 60, FADE_SECONDS, trimRef.current);
    // Persist a "live night" marker so a killed process can be reconciled on
    // the next launch (see the mount effect). Cleared by finishNight once
    // the night ends cleanly through either onNightEnded or a manual stop.
    saveMarker({
      episodeId: lead.id, startedAt: startedAtRef.current, timerMinutes: minutes,
      lineup: lineupRef.current, playedIds: playedIdsRef.current,
      feedTitles: feedTitlesRef.current, wasVaried: variedRef.current,
    });
    setShowRest(false);
    setPlaying(true);

    stopTick();
    tickRef.current = setInterval(() => {
      const end = endAtRef.current;
      if (end === null) return;
      const left = (end - Date.now()) / 1000;
      if (left <= 0) { stopTick(); return; } // native performs the actual stop
      // Purely observational: fed the current state, its return value is
      // ignored here. Native (via onNightEnded/finishNight) is the only thing
      // that ever ends or shortens a night — this only ever watches one.
      restRef.current?.tick({
        now: Date.now(),
        hidden: appStateRef.current !== "active",
        fadingOrDone: left <= FADE_SECONDS,
      });
      // The same fade curve (and per-feed trim) the web player uses, from the
      // shared repo, purely to reflect native's countdown/volume in the UI
      // while foregrounded. Native drives the real volume and the real stop
      // now.
      setVolume(effectiveVolume(left, FADE_SECONDS, trimRef.current));
      setRemaining(left);
    }, 1000);
  }

  async function onStart(strategy: Strategy, minutes: number) {
    if (!pool) return;
    const r = await chooseLineup(strategy, pool);
    if (!r) return;
    lineupRef.current = r.lineup;
    playedIdsRef.current = [];
    variedRef.current = r.wasVaried;
    await beginPlayback(r.lead, minutes);
  }

  async function onResume() {
    const last = loadLastNight();
    const r = resumeNight(loadTimerMinutes());
    if (!last || !r) return;
    lineupRef.current = last.pool;
    playedIdsRef.current = [...last.playedIds];
    variedRef.current = last.wasVaried;
    await beginPlayback(r.lead, r.minutes);
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
        ) : playing && now ? (
          <PlayerScreen title={now.title} remaining={remaining} volume={volume} onStop={() => endSession()} onInteract={() => restRef.current?.noteInteraction()} />
        ) : showRest ? (
          <RestScreen onClose={() => setShowRest(false)} />
        ) : (
          <SetupScreen onStart={onStart} onResume={onResume} resumeAvailable={!!resumeNight(loadTimerMinutes())} onOpenRest={() => setShowRest(true)} />
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
