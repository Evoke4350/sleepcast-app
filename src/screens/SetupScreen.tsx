import React, { useState } from "react";
import { ScrollView, View, Text, TextInput, TouchableOpacity, Switch, StyleSheet, Share } from "react-native";
import {
  loadState, saveState, addCustomFeed, removeCustomFeed, saveTimerMinutes,
} from "../../vendor/player/src/lib/store";
import { parseOpml, buildOpml } from "../platform/opml";
import type { AppState } from "../../vendor/player/src/lib/store";

// All >= the vendor store's TIMER_MIN (5); a sub-minimum chip would start that
// many minutes but silently persist as 5, so the selection wouldn't survive a
// relaunch honestly.
const TIMERS = [5, 45, 60];

interface SetupProps {
  onStart: (strategy: "shuffle" | "spread" | "varied", minutes: number) => void;
  onResume?: () => void;
  resumeAvailable?: boolean;
}

export default function SetupScreen({ onStart, onResume, resumeAvailable }: SetupProps) {
  const [state, setState] = useState<AppState>(() => loadState());
  const [url, setUrl] = useState("");
  const [minutes, setMinutes] = useState(state.settings.timerMinutes);

  function persist(next: AppState) { saveState(next); setState(next); }

  function toggleFeed(id: string, enabled: boolean) {
    persist({ ...state, feeds: state.feeds.map((f) => (f.id === id ? { ...f, enabled } : f)) });
  }
  function addFeed() {
    if (!url.trim()) return;
    try { persist(addCustomFeed(state, url.trim())); setUrl(""); } catch { /* invalid url: leave text for correction */ }
  }
  function removeFeed(id: string) { persist(removeCustomFeed(state, id)); }
  async function exportOpml() {
    const xml = buildOpml(state.feeds.filter((f) => f.enabled).map((f) => ({ url: f.url, title: f.title })));
    await Share.share({ message: xml });
  }
  function importOpml(xml: string) {
    let parsed;
    try { parsed = parseOpml(xml); } catch { return; }
    let next = state;
    for (const feed of parsed) {
      try { next = addCustomFeed(next, feed.url, feed.title ?? undefined); } catch { /* skip bad entry */ }
    }
    persist(next);
  }
  function pickTimer(m: number) { setMinutes(m); saveTimerMinutes(m); }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.body}>
      <Text style={s.h}>feeds</Text>
      {state.feeds.map((f) => (
        <View key={f.id} style={s.feedRow}>
          <Text style={s.feedTitle} numberOfLines={1}>{f.title}</Text>
          <Switch testID={`feed-toggle-${f.id}`} value={f.enabled} onValueChange={(v) => toggleFeed(f.id, v)} />
          {!f.builtin && (
            <TouchableOpacity testID={`feed-remove-${f.id}`} onPress={() => removeFeed(f.id)}>
              <Text style={s.remove}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      <View style={s.addRow}>
        <TextInput
          testID="add-feed-input" style={s.input} placeholder="https://feed…"
          placeholderTextColor="#4a4436" autoCapitalize="none" value={url} onChangeText={setUrl}
        />
        <TouchableOpacity testID="add-feed" style={s.btn} onPress={addFeed}><Text style={s.btnT}>add</Text></TouchableOpacity>
      </View>
      <View style={s.addRow}>
        <TouchableOpacity testID="opml-import" style={s.btn} onPress={() => importOpml("")}><Text style={s.btnT}>import OPML</Text></TouchableOpacity>
        <TouchableOpacity testID="opml-export" style={s.btn} onPress={exportOpml}><Text style={s.btnT}>export OPML</Text></TouchableOpacity>
      </View>

      <Text style={s.h}>timer</Text>
      <View style={s.row}>
        {TIMERS.map((m) => (
          <TouchableOpacity key={m} testID={`timer-${m}`} style={[s.chip, minutes === m && s.chipOn]} onPress={() => pickTimer(m)}>
            <Text style={s.btnT}>{m}m</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.h}>start</Text>
      <View style={s.row}>
        <TouchableOpacity testID="start-shuffle" style={s.btn} onPress={() => onStart("shuffle", minutes)}><Text style={s.btnT}>shuffle</Text></TouchableOpacity>
        <TouchableOpacity testID="start-spread" style={s.btn} onPress={() => onStart("spread", minutes)}><Text style={s.btnT}>spread</Text></TouchableOpacity>
        <TouchableOpacity testID="start-varied" style={s.btn} onPress={() => onStart("varied", minutes)}><Text style={s.btnT}>varied</Text></TouchableOpacity>
      </View>
      {resumeAvailable && (
        <TouchableOpacity testID="start-resume" style={s.btn} onPress={onResume}><Text style={s.btnT}>resume last night</Text></TouchableOpacity>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050508" },
  body: { padding: 24, gap: 12 },
  h: { color: "#6e5d44", fontSize: 12, textTransform: "uppercase", marginTop: 12 },
  feedRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  feedTitle: { color: "#c8c0b0", flex: 1, fontSize: 14 },
  remove: { color: "#b3746b", fontSize: 16, paddingHorizontal: 6 },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, color: "#d9c9a8", borderWidth: 1, borderColor: "#3a3325", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { borderColor: "#d9c9a8" },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  btnT: { color: "#d9c9a8", fontSize: 14 },
});
