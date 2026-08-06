import React, { useState } from "react";
import { ScrollView, View, Text, TextInput, TouchableOpacity, Switch, StyleSheet, Share } from "react-native";
import {
  loadState, saveState, addCustomFeed, removeCustomFeed, saveTimerMinutes,
} from "../../vendor/player/src/lib/store";
import { parseOpml, buildOpml } from "../platform/opml";
import { nextTrim } from "../logic/trim";
import type { AppState } from "../../vendor/player/src/lib/store";
import { youtubeFeedUrl, isYouTubeFeedUrl } from "../platform/youtube-url";
import { resolveYouTubeFeedUrl } from "../platform/youtube-add";
import { YOUTUBE } from "../features";
import { qualifiesForStepBack, isQuiet, quietUntilFrom } from "../../vendor/player/src/lib/rest/stepback";
import { loadNights, loadQuietUntil, saveQuietUntil, loadStepBackAsked, markStepBackAsked } from "../../vendor/player/src/lib/rest/ledger";

// All >= the vendor store's TIMER_MIN (5); a sub-minimum chip would start that
// many minutes but silently persist as 5, so the selection wouldn't survive a
// relaunch honestly.
const TIMERS = [5, 45, 60];

interface SetupProps {
  onStart: (strategy: "shuffle" | "spread" | "varied", minutes: number) => void;
  onResume?: () => void;
  resumeAvailable?: boolean;
  onOpenRest?: () => void;
}

export default function SetupScreen({ onStart, onResume, resumeAvailable, onOpenRest }: SetupProps) {
  const [state, setState] = useState<AppState>(() => loadState());
  const [url, setUrl] = useState("");
  const [minutes, setMinutes] = useState(state.settings.timerMinutes);
  const [feedError, setFeedError] = useState<string | null>(null);
  // Eligibility for the step-back offer, computed once on mount: not
  // currently quiet, not asked within a quiet window of a previous ask, and
  // the run itself qualifies (see vendor rest/stepback.ts).
  const [showStepBack, setShowStepBack] = useState(() => {
    const now = Date.now();
    if (isQuiet(loadQuietUntil(), now)) return false;
    const asked = loadStepBackAsked();
    if (asked !== null && isQuiet(quietUntilFrom(asked), now)) return false;
    return qualifiesForStepBack(loadNights());
  });

  function persist(next: AppState) { saveState(next); setState(next); }
  function acceptStepBack() { const now = Date.now(); saveQuietUntil(quietUntilFrom(now)); markStepBackAsked(now); setShowStepBack(false); }
  function declineStepBack() { markStepBackAsked(Date.now()); setShowStepBack(false); }

  function toggleFeed(id: string, enabled: boolean) {
    persist({ ...state, feeds: state.feeds.map((f) => (f.id === id ? { ...f, enabled } : f)) });
  }
  async function addFeed() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setFeedError(null);
    if (youtubeFeedUrl(trimmed)) {
      if (!YOUTUBE) {
        setFeedError("YouTube isn't available in this build");
        return;
      }
      const resolved = await resolveYouTubeFeedUrl(trimmed);
      if (!resolved.ok) {
        setFeedError(resolved.reason === "video" ? "that's a video, not a channel" : "couldn't find that channel");
        return;
      }
      try { persist(addCustomFeed(state, resolved.feedUrl, undefined)); setUrl(""); } catch { /* invalid url: leave text for correction */ }
      return;
    }
    try { persist(addCustomFeed(state, trimmed)); setUrl(""); } catch { /* invalid url: leave text for correction */ }
  }
  function removeFeed(id: string) { persist(removeCustomFeed(state, id)); }
  function stepTrim(id: string, dir: 1 | -1) {
    const cur = state.settings.feedTrim[id] ?? 1;
    const next = nextTrim(cur, dir);
    persist({ ...state, settings: { ...state.settings, feedTrim: { ...state.settings.feedTrim, [id]: next } } });
  }
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

  // A night can only be all-YouTube or all-podcast: the player has no way to
  // mix the two backends within one pool, so enabling both kinds at once
  // blocks starting rather than silently dropping one.
  const enabledFeeds = state.feeds.filter((f) => f.enabled).map((f) => f.url);
  const mixed = enabledFeeds.some(isYouTubeFeedUrl) && enabledFeeds.some((u) => !isYouTubeFeedUrl(u));
  function startIfNotMixed(strategy: "shuffle" | "spread" | "varied", m: number) {
    if (mixed) return;
    onStart(strategy, m);
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.body}>
      {showStepBack && (
        <View testID="stepback-offer" style={s.stepback}>
          <Text style={s.sbTitle}>you've been falling asleep quickly for a while.</Text>
          <Text style={s.sbBody}>you might not need us right now — we can stop nudging and stay out of the way for a month.</Text>
          <View style={s.row}>
            <TouchableOpacity testID="stepback-accept" accessibilityRole="button" accessibilityLabel="go quiet" style={s.btn} onPress={acceptStepBack}><Text style={s.btnT}>go quiet</Text></TouchableOpacity>
            <TouchableOpacity testID="stepback-decline" accessibilityRole="button" accessibilityLabel="not now" style={s.btn} onPress={declineStepBack}><Text style={s.btnT}>not now</Text></TouchableOpacity>
          </View>
        </View>
      )}
      <Text style={s.h}>feeds</Text>
      {state.feeds.map((f) => (
        <View key={f.id} style={s.feedRowContainer}>
          <View style={s.feedRow}>
            <Text style={s.feedTitle} numberOfLines={1}>{f.title}</Text>
            <Switch
              testID={`feed-toggle-${f.id}`}
              accessibilityLabel={`${f.title} feed`}
              value={f.enabled}
              onValueChange={(v) => toggleFeed(f.id, v)}
            />
            {!f.builtin && (
              <TouchableOpacity
                testID={`feed-remove-${f.id}`}
                accessibilityRole="button"
                accessibilityLabel={`remove ${f.title}`}
                onPress={() => removeFeed(f.id)}
              >
                <Text style={s.remove}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={s.trimRow}>
            <TouchableOpacity
              testID={`trim-down-${f.id}`}
              accessibilityRole="button"
              accessibilityLabel={`quieter — ${f.title}`}
              onPress={() => stepTrim(f.id, -1)}
              style={s.trimBtn}
            ><Text style={s.trimBtnT}>−</Text></TouchableOpacity>
            <Text
              testID={`trim-value-${f.id}`}
              style={s.trimVal}
              accessibilityRole="adjustable"
              accessibilityValue={{ text: `${(state.settings.feedTrim[f.id] ?? 1).toFixed(2)} times` }}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === "increment") stepTrim(f.id, 1);
                else if (e.nativeEvent.actionName === "decrement") stepTrim(f.id, -1);
              }}
            >{`${(state.settings.feedTrim[f.id] ?? 1).toFixed(2)}×`}</Text>
            <TouchableOpacity
              testID={`trim-up-${f.id}`}
              accessibilityRole="button"
              accessibilityLabel={`louder — ${f.title}`}
              onPress={() => stepTrim(f.id, 1)}
              style={s.trimBtn}
            ><Text style={s.trimBtnT}>+</Text></TouchableOpacity>
          </View>
        </View>
      ))}
      <View style={s.addRow}>
        <TextInput
          testID="add-feed-input" style={s.input} placeholder="https://feed…"
          accessibilityLabel="feed URL"
          placeholderTextColor="#4a4436" autoCapitalize="none" value={url} onChangeText={setUrl}
        />
        <TouchableOpacity testID="add-feed" accessibilityRole="button" accessibilityLabel="add feed" style={s.btn} onPress={addFeed}><Text style={s.btnT}>add</Text></TouchableOpacity>
      </View>
      {feedError && (
        <Text testID="feed-error" style={s.feedError} accessibilityRole="alert" accessibilityLiveRegion="polite">{feedError}</Text>
      )}
      <View style={s.addRow}>
        <TouchableOpacity testID="opml-import" accessibilityRole="button" accessibilityLabel="import OPML file" style={s.btn} onPress={() => importOpml("")}><Text style={s.btnT}>import OPML</Text></TouchableOpacity>
        <TouchableOpacity testID="opml-export" accessibilityRole="button" accessibilityLabel="export OPML file" style={s.btn} onPress={exportOpml}><Text style={s.btnT}>export OPML</Text></TouchableOpacity>
      </View>

      <Text style={s.h}>timer</Text>
      <View style={s.row}>
        {TIMERS.map((m) => (
          <TouchableOpacity
            key={m}
            testID={`timer-${m}`}
            accessibilityRole="button"
            accessibilityLabel={`${m} minute timer`}
            accessibilityState={{ selected: minutes === m }}
            style={[s.chip, minutes === m && s.chipOn]}
            onPress={() => pickTimer(m)}
          >
            <Text style={s.btnT}>{m}m</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.h}>get-up nudge</Text>
      <View style={s.qhRow}>
        <Text style={s.qhLabel}>stop & suggest getting up after 25 restless minutes</Text>
        <Switch
          testID="quarterhour-toggle"
          accessibilityLabel="get-up nudge: stop and suggest getting up after 25 restless minutes"
          value={state.settings.quarterHourRule}
          onValueChange={(v) => persist({ ...state, settings: { ...state.settings, quarterHourRule: v } })}
        />
      </View>

      <Text style={s.h}>start</Text>
      {mixed && (
        <Text testID="mix-warning" style={s.mixWarning} accessibilityRole="alert" accessibilityLiveRegion="polite">
          a YouTube night can't mix with podcast feeds — turn one kind off
        </Text>
      )}
      <View style={s.row}>
        <TouchableOpacity testID="start-shuffle" accessibilityRole="button" accessibilityLabel="start — shuffle" disabled={mixed} style={s.btn} onPress={() => startIfNotMixed("shuffle", minutes)}><Text style={s.btnT}>shuffle</Text></TouchableOpacity>
        <TouchableOpacity testID="start-spread" accessibilityRole="button" accessibilityLabel="start — spread" disabled={mixed} style={s.btn} onPress={() => startIfNotMixed("spread", minutes)}><Text style={s.btnT}>spread</Text></TouchableOpacity>
        <TouchableOpacity testID="start-varied" accessibilityRole="button" accessibilityLabel="start — varied" disabled={mixed} style={s.btn} onPress={() => startIfNotMixed("varied", minutes)}><Text style={s.btnT}>varied</Text></TouchableOpacity>
      </View>
      {resumeAvailable && (
        <TouchableOpacity testID="start-resume" accessibilityRole="button" accessibilityLabel="resume last night" style={s.btn} onPress={onResume}><Text style={s.btnT}>resume last night</Text></TouchableOpacity>
      )}

      {onOpenRest && (
        <TouchableOpacity testID="open-rest" accessibilityRole="link" accessibilityLabel="sleep history" onPress={onOpenRest} style={s.nightsLink}>
          <Text style={s.nightsText}>nights ›</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050508" },
  body: { padding: 24, gap: 12 },
  h: { color: "#9a875f", fontSize: 12, textTransform: "uppercase", marginTop: 12 },
  feedRowContainer: { flexDirection: "column", gap: 6 },
  feedRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  feedTitle: { color: "#c8c0b0", flex: 1, fontSize: 14 },
  remove: { color: "#b3746b", fontSize: 16, paddingHorizontal: 6 },
  trimRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  trimBtn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, minWidth: 30, minHeight: 30, alignItems: "center", justifyContent: "center" },
  trimBtnT: { color: "#d9c9a8", fontSize: 16 },
  trimVal: { color: "#8a7a5c", fontSize: 12, minWidth: 44, textAlign: "center" },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, color: "#d9c9a8", borderWidth: 1, borderColor: "#3a3325", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  feedError: { color: "#b3746b", fontSize: 12 },
  mixWarning: { color: "#b3746b", fontSize: 12, marginBottom: 4 },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  qhRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  qhLabel: { color: "#c8c0b0", flex: 1, fontSize: 13 },
  chip: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { borderColor: "#d9c9a8" },
  btn: { borderWidth: 1, borderColor: "#3a3325", borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  btnT: { color: "#d9c9a8", fontSize: 14 },
  nightsLink: { marginTop: 12 },
  nightsText: { color: "#9a875f", fontSize: 13 },
  stepback: { alignSelf: "stretch", borderWidth: 1, borderColor: "#3a3325", borderRadius: 12, backgroundColor: "#171310", padding: 16, gap: 8 },
  sbTitle: { color: "#d9c9a8", fontSize: 14 },
  sbBody: { color: "#8a7a5c", fontSize: 12 },
});
