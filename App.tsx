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
import { recordHeardPlay, saveLastNight, loadTimerMinutes } from "./vendor/player/src/lib/store";
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

  useEffect(() => {
    buildPool(nativeFetch)
      .then(({ pool, errors }) => {
        if (!pool.length) throw new Error(errors[0] ?? "no episodes");
        setPool(pool);
      })
      .catch((e) => setError(String(e?.message ?? e)));
    return () => stopTick();
  }, []);

  function stopTick() {
    if (tickRef.current !== null) clearInterval(tickRef.current);
    tickRef.current = null;
  }

  async function endSession(via: "faded" | "abandoned") {
    stopTick();
    endAtRef.current = null;
    getNightAudio()?.stop();
    if (now) {
      saveLastNight({
        pool: lineupRef.current, playedIds: [now.id], feedTitles: {}, artworkByFeedId: {},
        skipIntroByFeedId: {}, endedVia: via, endedAt: Date.now(), wasVaried: variedRef.current,
      });
    }
    setPlaying(false);
    setNow(null);
    setRemaining(0);
    setVolume(1);
  }

  async function beginPlayback(lead: Episode, minutes: number) {
    setNow(lead);
    startedAtRef.current = Date.now();
    endAtRef.current = Date.now() + minutes * 60_000;
    // Metadata first: it has to be on the MediaItem when playback starts, or
    // the lock screen shows nothing and setting it later restarts the audio.
    getNightAudio()?.setNowPlaying(lead.title, "sleepcast", "", 0);
    await getNightAudio()?.play(lead.url, 0);
    setPlaying(true);

    stopTick();
    tickRef.current = setInterval(async () => {
      const end = endAtRef.current;
      if (end === null) return;
      const left = (end - Date.now()) / 1000;
      if (left <= 0) {
        // The ledger only counts what was actually heard.
        recordHeardPlay({
          id: lead.id, title: lead.title, feedId: lead.feedId,
          startedAt: startedAtRef.current,
          heardSec: Math.round((Date.now() - startedAtRef.current) / 1000),
        });
        await endSession("faded");
        return;
      }
      // The same fade curve the web player uses, from the shared repo. The
      // native module never computes it.
      const v = fadeVolume(left, FADE_SECONDS);
      getNightAudio()?.setVolume(v);
      setVolume(v);
      setRemaining(left);
    }, 1000);
  }

  async function onStart(strategy: Strategy, minutes: number) {
    if (!pool) return;
    const r = await chooseLineup(strategy, pool);
    if (!r) return;
    lineupRef.current = r.lineup;
    variedRef.current = r.wasVaried;
    await beginPlayback(r.lead, minutes);
  }

  async function onResume() {
    const r = resumeNight(loadTimerMinutes());
    if (!r) return;
    lineupRef.current = [r.lead];
    variedRef.current = false;
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
          <PlayerScreen title={now.title} remaining={remaining} volume={volume} onStop={() => endSession("abandoned")} />
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
