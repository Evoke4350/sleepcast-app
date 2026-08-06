import React from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { formatTime, type Episode } from "../../vendor/player/src/lib/engine";

interface PlayerProps {
  title: string;
  remaining: number;
  volume: number;
  onStop: () => void;
  onInteract?: () => void;
  // Multi-episode nights (varied/spread) pass the lineup so the listener can
  // see the picks, jump to any of them, or advance to the next. Absent or
  // length ≤ 1 (shuffle) → the single-episode view, unchanged.
  lineup?: Episode[];
  currentId?: string;
  feedTitles?: Record<string, string>;
  onSelect?: (ep: Episode) => void;
  onNext?: () => void;
  // Leave the player for the home/setup screen WITHOUT stopping playback (the
  // native foreground service keeps the audio + timer going).
  onHome?: () => void;
}

function humanTime(sec: number): string {
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60);
  const minText = minutes === 1 ? "minute" : "minutes";
  const secText = seconds === 1 ? "second" : "seconds";
  return `${minutes} ${minText} ${seconds} ${secText} remaining`;
}

export default function PlayerScreen({
  title, remaining, volume, onStop, onInteract,
  lineup, currentId, feedTitles, onSelect, onNext, onHome,
}: PlayerProps) {
  const showList = !!lineup && lineup.length > 1;
  return (
    <View
      style={s.body}
      testID="player-root"
      onStartShouldSetResponderCapture={() => { onInteract?.(); return false; }}
    >
      <Text style={s.moon} accessibilityElementsHidden={true} importantForAccessibility="no-hide-descendants">☾</Text>
      <Text style={s.title} testID="nowPlaying" numberOfLines={2} accessibilityRole="header">{title}</Text>
      <Text style={s.dim} testID="countdown" accessibilityLabel={humanTime(remaining)}>{formatTime(remaining)}</Text>
      <Text style={s.dim} testID="volume" accessibilityLabel={`volume ${Math.round(volume * 100)} percent`}>vol {volume.toFixed(2)}</Text>
      <View style={s.controls}>
        {onHome && (
          <TouchableOpacity style={s.btn} testID="home" accessibilityRole="button" accessibilityLabel="back to home, keep playing" onPress={onHome}>
            <Text style={s.btnT}>home</Text>
          </TouchableOpacity>
        )}
        {showList && (
          <TouchableOpacity style={s.btn} testID="skip-next" accessibilityRole="button" accessibilityLabel="next episode" onPress={onNext}>
            <Text style={s.btnT}>next</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.btn} testID="stop" onPress={onStop} accessibilityRole="button" accessibilityLabel="stop"><Text style={s.btnT}>stop</Text></TouchableOpacity>
      </View>

      {showList && (
        <ScrollView style={s.list} contentContainerStyle={s.listContent} testID="lineup-list">
          {lineup!.map((ep) => {
            const selected = ep.id === currentId;
            const feed = feedTitles?.[ep.feedId];
            return (
              <TouchableOpacity
                key={ep.id}
                testID={`lineup-row-${ep.id}`}
                style={[s.row, selected && s.rowCurrent]}
                disabled={selected}
                onPress={() => onSelect?.(ep)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${selected ? "now playing" : "play"} ${ep.title}${feed ? `, ${feed}` : ""}`}
              >
                <Text style={[s.rowTitle, selected && s.rowTitleCurrent]} numberOfLines={2}>
                  {selected ? "‣ " : ""}{ep.title}
                </Text>
                {feed ? <Text style={s.rowFeed} numberOfLines={1}>{feed}</Text> : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 24 },
  moon: { fontSize: 56, color: "#f0dcb8" },
  title: { color: "#c8c0b0", fontSize: 16, textAlign: "center" },
  dim: { color: "#9a875f", fontSize: 13 },
  controls: { flexDirection: "row", gap: 12 },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  btnT: { color: "#d9c9a8", fontSize: 14 },
  list: { alignSelf: "stretch", maxHeight: 280, marginTop: 4 },
  listContent: { gap: 6, paddingBottom: 8 },
  row: { borderWidth: 1, borderColor: "#241f18", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  rowCurrent: { borderColor: "#6f6a62", backgroundColor: "#12100c" },
  rowTitle: { color: "#b0a898", fontSize: 14 },
  rowTitleCurrent: { color: "#d9c9a8" },
  rowFeed: { color: "#6f6a62", fontSize: 12, marginTop: 2 },
});
