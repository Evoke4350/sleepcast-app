import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import t from "../theme/tokens";

export default function GettingUpScreen({ onDismiss }: { onDismiss: () => void }) {
  return (
    <View style={s.body} testID="gettingup" accessibilityLiveRegion="polite">
      <Text style={s.title} accessibilityRole="header">you've been up a while</Text>
      <Text style={s.body2}>
        the bed works best when it's just for sleep. try getting up for a few
        minutes — a glass of water, a dim room — and come back when you're heavy.
      </Text>
      <TouchableOpacity style={s.btn} testID="gettingup-dismiss" activeOpacity={t.ios ? 0.6 : 0.2} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="ok">
        <Text style={s.btnT}>ok</Text>
      </TouchableOpacity>
    </View>
  );
}

const androidStyles = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 20, padding: 32 },
  title: { color: "#c8c0b0", fontSize: 20 },
  body2: { color: "#8a7a5c", fontSize: 14, textAlign: "center", lineHeight: 21 },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 24, paddingVertical: 10, marginTop: 8 },
  btnT: { color: "#d9c9a8", fontSize: 15 },
});

const iosStyles = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: t.space(5), padding: t.space(8) },
  title: { color: t.color.textSecondary, ...t.type.title, fontSize: 20 },
  body2: { color: t.color.textMuted, ...t.type.bodySm, textAlign: "center", lineHeight: 21 },
  btn: { borderWidth: 1, borderColor: t.color.hairline, borderRadius: t.radius.pill, paddingHorizontal: t.space(6), paddingVertical: t.space(2.5), marginTop: t.space(2), minHeight: 44, alignItems: "center", justifyContent: "center" },
  btnT: { color: t.color.textPrimary, ...t.type.bodySm },
});

const s = t.ios ? iosStyles : androidStyles;
