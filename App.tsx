import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from "react-native";
// Not react-native's SafeAreaView, which is deprecated in 0.86 and warns on
// every render. react-native-safe-area-context was already a dependency here;
// the import was simply pointing at the wrong one.
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { installLocalStorage } from "./src/platform/storage";
import { buildPool } from "./src/platform/feeds";
import { chooseLineup, resumeNight, type Strategy } from "./src/logic/selection";
import { getNightAudio } from "./src/specs/NativeNightAudio";
import { fadeVolume } from "./vendor/player/src/lib/engine";
import { recordHeardPlay, saveLastNight, loadTimerMinutes, loadLastNight } from "./vendor/player/src/lib/store";
import { HEARD_SEC } from "./vendor/player/src/lib/plays";
import type { Episode } from "./vendor/player/src/lib/engine";
import SetupScreen from "./src/screens/SetupScreen";
import PlayerScreen from "./src/screens/PlayerScreen";

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

  const endAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const lineupRef = useRef<Episode[]>([]);
  const variedRef = useRef(false);
  const nowRef = useRef<Episode | null>(null);
  const playedIdsRef = useRef<string[]>([]);
  const feedTitlesRef = useRef<Record<string, string>>({});

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
    // Match against what's actually playing/queued; do NOT fall back to
    // nowRef when the id matches neither — that would misattribute a
    // stale/late event to the wrong episode. finishNight(null, …) is a safe
    // no-op write in that case.
    const ep = (nowRef.current && nowRef.current.id === episodeId)
      ? nowRef.current
      : (lineupRef.current.find((e) => e.id === episodeId) ?? null);
    finishNight(ep, heardSeconds, "faded");
  }

  async function beginPlayback(lead: Episode, minutes: number) {
    setNow(lead);
    nowRef.current = lead;
    startedAtRef.current = Date.now();
    endAtRef.current = Date.now() + minutes * 60_000;
    // Metadata first: it has to be on the MediaItem when playback starts, or
    // the lock screen shows nothing and setting it later restarts the audio.
    getNightAudio()?.setNowPlaying(lead.title, "sleepcast", "", 0);
    await getNightAudio()?.play(lead.url, 0);
    // Native now owns the fade/stop: it keeps running even if the screen
    // locks and JS timers suspend. It reports back via onNightEnded.
    getNightAudio()?.scheduleFadeAndStop(lead.id, minutes * 60, FADE_SECONDS);
    setPlaying(true);

    stopTick();
    tickRef.current = setInterval(() => {
      const end = endAtRef.current;
      if (end === null) return;
      const left = (end - Date.now()) / 1000;
      if (left <= 0) { stopTick(); return; } // native performs the actual stop
      // The same fade curve the web player uses, from the shared repo, purely
      // to reflect native's countdown/volume in the UI while foregrounded.
      // Native drives the real volume and the real stop now.
      setVolume(fadeVolume(left, FADE_SECONDS));
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
          <PlayerScreen title={now.title} remaining={remaining} volume={volume} onStop={() => endSession()} />
        ) : (
          <SetupScreen onStart={onStart} onResume={onResume} resumeAvailable={!!resumeNight(loadTimerMinutes())} />
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
