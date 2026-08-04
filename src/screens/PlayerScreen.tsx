import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { formatTime } from "../../vendor/player/src/lib/engine";

interface PlayerProps { title: string; remaining: number; volume: number; onStop: () => void; }

export default function PlayerScreen({ title, remaining, volume, onStop }: PlayerProps) {
  return (
    <View style={s.body}>
      <Text style={s.moon}>☾</Text>
      <Text style={s.title} testID="nowPlaying" numberOfLines={2}>{title}</Text>
      <Text style={s.dim} testID="countdown">{formatTime(remaining)}</Text>
      <Text style={s.dim} testID="volume">vol {volume.toFixed(2)}</Text>
      <TouchableOpacity style={s.btn} testID="stop" onPress={onStop}><Text style={s.btnT}>stop</Text></TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 24 },
  moon: { fontSize: 56, color: "#f0dcb8" },
  title: { color: "#c8c0b0", fontSize: 16, textAlign: "center" },
  dim: { color: "#6e5d44", fontSize: 13 },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  btnT: { color: "#d9c9a8", fontSize: 14 },
});
