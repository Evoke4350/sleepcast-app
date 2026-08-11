import React, { useMemo } from "react";
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { loadNights, rollup, setSelfLabel, loadParams, saveParams } from "../../vendor/player/src/lib/rest/ledger";
import { tightenAfterFalsePositive, paramsFromHistory } from "../../vendor/player/src/lib/rest/calibrate";
import { fmtDuration, lastNight } from "../../vendor/player/src/lib/rest/surface";
import { getPlays } from "../../vendor/player/src/lib/store";
import { playsSince, playAtMoment } from "../../vendor/player/src/lib/plays";
import t from "../theme/tokens";

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
      // A "no" on a scored night is a confirmed false positive. Params are not
      // seeded until the first calibration, so fall back to history-derived
      // params — otherwise the very tightening this button exists for never
      // happens (loadParams() stays null on a real device).
      const p = loadParams() ?? paramsFromHistory(loadNights());
      saveParams(tightenAfterFalsePositive(p));
    }
    onClose();
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.body}>
      <View style={s.stat} accessible={true} accessibilityLabel={`${r.nightsSlept} nights you drifted off`}>
        <Text style={s.big} testID="rest-nights">{r.nightsSlept}</Text>
        <Text style={s.cap}>nights you drifted off</Text>
      </View>
      {r.bestTimeToSleepMs !== null && (
        <View style={s.stat} accessible={true} accessibilityLabel={`fastest you left us, ${fmtDuration(r.bestTimeToSleepMs)}`}>
          <Text style={s.mid} testID="rest-best">{fmtDuration(r.bestTimeToSleepMs)}</Text>
          <Text style={s.cap}>fastest you left us</Text>
        </View>
      )}
      {r.medianTimeToSleepMs !== null && (
        <View style={s.stat} accessible={true} accessibilityLabel={`you usually take ${fmtDuration(r.medianTimeToSleepMs)}`}>
          <Text style={s.mid} testID="rest-median">{fmtDuration(r.medianTimeToSleepMs)}</Text>
          <Text style={s.cap}>how long you usually take</Text>
        </View>
      )}
      {lastPlays.length > 0 && (
        <View style={s.section}>
          <Text style={s.cap}>last night</Text>
          {lastPlays.map((p) => (
            <View
              key={p.id}
              style={s.playRow}
              accessible={true}
              accessibilityLabel={`${p.title || "an episode"}, ${Math.max(1, Math.round(p.heardSec / 60))} minutes${driftedDuring?.id === p.id ? ", you drifted off here" : ""}`}
            >
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
            <TouchableOpacity testID="rest-label-yes" style={s.btn} activeOpacity={t.ios ? 0.6 : 0.2} onPress={() => label("slept")} accessibilityRole="button" accessibilityLabel="yes, I fell asleep to it"><Text style={s.btnT}>yes</Text></TouchableOpacity>
            <TouchableOpacity testID="rest-label-no" style={s.btn} activeOpacity={t.ios ? 0.6 : 0.2} onPress={() => label("awake")} accessibilityRole="button" accessibilityLabel="no, I stayed awake"><Text style={s.btnT}>no</Text></TouchableOpacity>
          </View>
        </View>
      )}
      <Text style={s.note}>counted only on this device. nothing sent anywhere.</Text>
      <TouchableOpacity testID="rest-back" activeOpacity={t.ios ? 0.6 : 0.2} onPress={onClose} accessibilityRole="button" accessibilityLabel="back"><Text style={s.back}>back</Text></TouchableOpacity>
    </ScrollView>
  );
}

const androidStyles = StyleSheet.create({
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
  drift: { color: "#9a875f", fontSize: 11 },
  prompt: { color: "#8a7a5c", fontSize: 14 },
  row: { flexDirection: "row", gap: 12 },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
  btnT: { color: "#d9c9a8", fontSize: 14 },
  note: { color: "#6f6a62", fontSize: 11, textAlign: "center" },
  back: { color: "#8a7a5c", fontSize: 12, textDecorationLine: "underline" },
});

const iosStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.color.ground },
  body: { padding: t.space(6), gap: t.space(7), alignItems: "center" },
  stat: { alignItems: "center", gap: t.space(1) },
  big: { color: t.color.textSecondary, ...t.type.display, fontSize: 48 },
  mid: { color: t.color.textSecondary, ...t.type.title },
  cap: { color: t.color.textMuted, ...t.type.micro },
  section: { alignSelf: "stretch", borderTopWidth: 1, borderTopColor: t.color.hairline, paddingTop: t.space(6), gap: t.space(2.5), alignItems: "center" },
  playRow: { alignSelf: "stretch", gap: t.space(0.5) },
  playTitle: { color: t.color.textSecondary, ...t.type.bodySm },
  playMin: { color: t.color.textMuted, fontSize: 11 },
  drift: { color: t.color.label, fontSize: 11 },
  prompt: { color: t.color.textMuted, ...t.type.bodySm },
  row: { flexDirection: "row", gap: t.space(3) },
  btn: { borderWidth: 1, borderColor: t.color.hairline, borderRadius: t.radius.pill, paddingHorizontal: t.space(4.5), paddingVertical: t.space(2.5), minHeight: 44, alignItems: "center", justifyContent: "center" },
  btnT: { color: t.color.textPrimary, ...t.type.bodySm },
  note: { color: t.color.textMuted, fontSize: 11, textAlign: "center" },
  back: { color: t.color.textMuted, ...t.type.label, textDecorationLine: "underline" },
});

const s = t.ios ? iosStyles : androidStyles;
