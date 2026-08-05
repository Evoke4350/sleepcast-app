import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

export default function GettingUpScreen({ onDismiss }: { onDismiss: () => void }) {
  return (
    <View style={s.body} testID="gettingup">
      <Text style={s.title}>you've been up a while</Text>
      <Text style={s.body2}>
        the bed works best when it's just for sleep. try getting up for a few
        minutes — a glass of water, a dim room — and come back when you're heavy.
      </Text>
      <TouchableOpacity style={s.btn} testID="gettingup-dismiss" onPress={onDismiss}>
        <Text style={s.btnT}>ok</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 20, padding: 32 },
  title: { color: "#c8c0b0", fontSize: 20 },
  body2: { color: "#8a7a5c", fontSize: 14, textAlign: "center", lineHeight: 21 },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 24, paddingVertical: 10, marginTop: 8 },
  btnT: { color: "#d9c9a8", fontSize: 15 },
});
