// TEMPORARY probe (Slice 6 Task 4): proves react-native-webview links under
// bridgeless new-arch and the YouTube IFrame player renders + plays on-device.
// Not wired into App.tsx in committed code — wire it behind an early return
// locally when re-verifying. Deleted/replaced by the real player in Task 5.
import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";

export default function WebViewSmoke() {
  const [state, setState] = useState("loading");
  const onChangeState = useCallback((s: string) => setState(s), []);
  return (
    <View style={styles.root}>
      <Text style={styles.label} testID="smoke-state">player state: {state}</Text>
      <YoutubePlayer
        height={220}
        play={true}
        videoId="dQw4w9WgXcQ"
        onChangeState={onChangeState}
        onReady={() => setState("ready")}
        onError={(e: string) => setState(`error:${e}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050508", justifyContent: "center" },
  label: { color: "#6e5d44", fontSize: 14, textAlign: "center", marginBottom: 12 },
});
