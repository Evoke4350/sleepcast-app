import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { formatTime } from "../../vendor/player/src/lib/engine";

interface PlayerProps { title: string; remaining: number; volume: number; onStop: () => void; onInteract?: () => void; }

function humanTime(sec: number): string {
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60);
  const minText = minutes === 1 ? "minute" : "minutes";
  const secText = seconds === 1 ? "second" : "seconds";
  return `${minutes} ${minText} ${seconds} ${secText} remaining`;
}

export default function PlayerScreen({ title, remaining, volume, onStop, onInteract }: PlayerProps) {
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
      <TouchableOpacity style={s.btn} testID="stop" onPress={onStop} accessibilityRole="button" accessibilityLabel="stop"><Text style={s.btnT}>stop</Text></TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 24 },
  moon: { fontSize: 56, color: "#f0dcb8" },
  title: { color: "#c8c0b0", fontSize: 16, textAlign: "center" },
  dim: { color: "#9a875f", fontSize: 13 },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  btnT: { color: "#d9c9a8", fontSize: 14 },
});
