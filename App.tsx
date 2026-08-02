import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";

import { installLocalStorage } from "./src/platform/storage";
import { parseFeed } from "./src/platform/feed";
import { getNightAudio } from "./src/specs/NativeNightAudio";
import { TurboModuleRegistry, NativeModules } from "react-native";
import { fadeVolume, formatTime } from "./vendor/player/src/lib/engine";
import { pickNextEpisode } from "./vendor/player/src/lib/plays";
import { getPlays, recordHeardPlay } from "./vendor/player/src/lib/store";
import type { Episode } from "./vendor/player/src/lib/engine";

// Must run before anything touches the shared code, which reads localStorage
// synchronously at module scope in places.
installLocalStorage();


// No relay. A native HTTP client has no CORS, so the whole SSRF-guarded proxy
// the web app needs simply does not exist here — this is one of the three
// reasons the native version is worth building.
const FEED_URL = "https://feed.sleepwithmepodcast.com/";
const FEED_ID = "swm";
const FADE_SECONDS = 60;

const TIMERS = [1, 5, 45];

export default function App() {
  const [pool, setPool] = useState<Episode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Episode | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [volume, setVolume] = useState(1);
  const [playing, setPlaying] = useState(false);

  const endAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  useEffect(() => {
    fetch(FEED_URL)
      .then((r) => r.text())
      .then((xml) => {
        const feed = parseFeed(xml, FEED_ID);
        if (feed.episodes.length === 0) throw new Error("feed had no episodes");
        setPool(feed.episodes);
      })
      .catch((e) => setError(String(e?.message ?? e)));
    return () => stopTick();
  }, []);

  function stopTick() {
    if (tickRef.current !== null) clearInterval(tickRef.current);
    tickRef.current = null;
  }

  async function endSession() {
    stopTick();
    endAtRef.current = null;
    getNightAudio()?.stop();
    setPlaying(false);
    setNow(null);
    setRemaining(0);
    setVolume(1);
  }

  async function startNight(minutes: number) {
    const ep = pickNextEpisode(pool, getPlays());
    if (!ep) return;
    setNow(ep);
    startedAtRef.current = Date.now();
    endAtRef.current = Date.now() + minutes * 60_000;
    // Metadata first: it has to be on the MediaItem when playback starts, or
    // the lock screen shows nothing and setting it later restarts the audio.
    getNightAudio()?.setNowPlaying(ep.title, "sleepcast", "", 0);
    await getNightAudio()?.play(ep.url, 0);
    setPlaying(true);

    stopTick();
    tickRef.current = setInterval(async () => {
      const end = endAtRef.current;
      if (end === null) return;
      const left = (end - Date.now()) / 1000;
      if (left <= 0) {
        // The ledger only counts what was actually heard.
        recordHeardPlay({
          id: ep.id, title: ep.title, feedId: ep.feedId,
          startedAt: startedAtRef.current,
          heardSec: Math.round((Date.now() - startedAtRef.current) / 1000),
        });
        await endSession();
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

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#050508" />
      <View style={s.body}>
        {error ? (
          <Text style={s.err} testID="error">{error}</Text>
        ) : pool.length === 0 ? (
          <>
            <ActivityIndicator color="#6e5d44" />
            <Text style={s.dim} testID="status">gathering episodes…</Text>
          </>
        ) : !playing ? (
          <>
            <Text style={s.dim} testID="pool">{pool.length} episodes ready</Text>
            <Text style={s.dim} testID="audioStatus">
              {getNightAudio() ? "audio: native module linked" : "audio: NOT LINKED (silent run)"}
            </Text>
            <Text style={s.dim} testID="diag">
              {/* globalThis, not global: `global` is a Node type this project
                  does not pull in (no @types/node), so it was the one thing
                  failing `tsc --noEmit`. Same object at runtime under Hermes. */}
              {`proxy:${typeof (globalThis as any).__turboModuleProxy} ` +
               `core:${TurboModuleRegistry.get("PlatformConstants") ? "ok" : "null"} ` +
               `nm:${Object.keys(NativeModules).length} ` +
               `mine:${TurboModuleRegistry.get("NightAudio") ? "ok" : "null"}`}
            </Text>
            <View style={s.row}>
              {TIMERS.map((m) => (
                <TouchableOpacity key={m} style={s.btn} testID={`start-${m}`} onPress={() => startNight(m)}>
                  <Text style={s.btnText}>{m} min</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : (
          <>
            <Text style={s.moon}>☾</Text>
            <Text style={s.title} testID="nowPlaying" numberOfLines={2}>{now?.title}</Text>
            <Text style={s.dim} testID="countdown">{formatTime(remaining)}</Text>
            <Text style={s.dim} testID="volume">vol {volume.toFixed(2)}</Text>
            <TouchableOpacity style={s.btn} testID="stop" onPress={endSession}>
              <Text style={s.btnText}>stop</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050508" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 24 },
  row: { flexDirection: "row", gap: 12 },
  moon: { fontSize: 56, color: "#f0dcb8" },
  title: { color: "#c8c0b0", fontSize: 16, textAlign: "center" },
  dim: { color: "#6e5d44", fontSize: 13 },
  err: { color: "#b3746b", fontSize: 13, textAlign: "center" },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  btnText: { color: "#d9c9a8", fontSize: 14 },
});
