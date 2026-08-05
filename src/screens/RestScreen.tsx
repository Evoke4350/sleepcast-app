import React, { useMemo } from "react";
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { loadNights, rollup, setSelfLabel, loadParams, saveParams } from "../../vendor/player/src/lib/rest/ledger";
import { tightenAfterFalsePositive } from "../../vendor/player/src/lib/rest/calibrate";
import { fmtDuration, lastNight } from "../../vendor/player/src/lib/rest/surface";
import { getPlays } from "../../vendor/player/src/lib/store";
import { playsSince, playAtMoment } from "../../vendor/player/src/lib/plays";

export default function RestScreen({ onClose }: { onClose: () => void }) {
  const nights = useMemo(() => loadNights(), []);
  const r = useMemo(() => rollup(nights), [nights]);
  const last = lastNight();
  const lastPlays = useMemo(() => (last ? playsSince(getPlays(), last.startedAt) : []), [last?.startedAt]);
  const driftedDuring = useMemo(
    () => (last && last.sleptAtMs !== null ? playAtMoment(lastPlays, last.startedAt + last.sleptAtMs) : null),
    [lastPlays, last?.startedAt, last?.sleptAtMs],
  );

  function label(kind: "slept" | "awake") {
    if (!last) return;
    setSelfLabel(last.startedAt, kind);
    if (kind === "awake" && last.sleptAtMs !== null) {
      const p = loadParams();
      if (p) saveParams(tightenAfterFalsePositive(p));
    }
    onClose();
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.body}>
      <View style={s.stat}>
        <Text style={s.big} testID="rest-nights">{r.nightsSlept}</Text>
        <Text style={s.cap}>nights you drifted off</Text>
      </View>
      {r.bestTimeToSleepMs !== null && (
        <View style={s.stat}>
          <Text style={s.mid} testID="rest-best">{fmtDuration(r.bestTimeToSleepMs)}</Text>
          <Text style={s.cap}>fastest you left us</Text>
        </View>
      )}
      {r.medianTimeToSleepMs !== null && (
        <View style={s.stat}>
          <Text style={s.mid} testID="rest-median">{fmtDuration(r.medianTimeToSleepMs)}</Text>
          <Text style={s.cap}>how long you usually take</Text>
        </View>
      )}
      {lastPlays.length > 0 && (
        <View style={s.section}>
          <Text style={s.cap}>last night</Text>
          {lastPlays.map((p) => (
            <View key={p.id} style={s.playRow}>
              <Text style={s.playTitle} numberOfLines={1}>{p.title || "an episode"}</Text>
              <Text style={s.playMin}>{Math.max(1, Math.round(p.heardSec / 60))} min</Text>
              {driftedDuring?.id === p.id && <Text style={s.drift}>you drifted off here</Text>}
            </View>
          ))}
        </View>
      )}
      {last && last.sleptAtMs !== null && last.selfLabel === undefined && (
        <View style={s.section}>
          <Text style={s.prompt}>did you fall asleep to it last time?</Text>
          <View style={s.row}>
            <TouchableOpacity testID="rest-label-yes" style={s.btn} onPress={() => label("slept")}><Text style={s.btnT}>yes</Text></TouchableOpacity>
            <TouchableOpacity testID="rest-label-no" style={s.btn} onPress={() => label("awake")}><Text style={s.btnT}>no</Text></TouchableOpacity>
          </View>
        </View>
      )}
      <Text style={s.note}>counted only on this device. nothing sent anywhere.</Text>
      <TouchableOpacity testID="rest-back" onPress={onClose}><Text style={s.back}>back</Text></TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050508" },
  body: { padding: 24, gap: 28, alignItems: "center" },
  stat: { alignItems: "center", gap: 4 },
  big: { color: "#c8c0b0", fontSize: 48 },
  mid: { color: "#b0a898", fontSize: 22 },
  cap: { color: "#8a7a5c", fontSize: 11, textTransform: "uppercase", letterSpacing: 2 },
  section: { alignSelf: "stretch", borderTopWidth: 1, borderTopColor: "#241f30", paddingTop: 24, gap: 10, alignItems: "center" },
  playRow: { alignSelf: "stretch", gap: 2 },
  playTitle: { color: "#b0a898", fontSize: 14 },
  playMin: { color: "#6b6255", fontSize: 11 },
  drift: { color: "#6e5d44", fontSize: 11 },
  prompt: { color: "#8a7a5c", fontSize: 14 },
  row: { flexDirection: "row", gap: 12 },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
  btnT: { color: "#d9c9a8", fontSize: 14 },
  note: { color: "#4a4540", fontSize: 11, textAlign: "center" },
  back: { color: "#8a7a5c", fontSize: 12, textDecorationLine: "underline" },
});
