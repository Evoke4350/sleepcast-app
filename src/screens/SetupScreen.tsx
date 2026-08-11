import React, { useState } from "react";
import { ScrollView, View, Text, TextInput, TouchableOpacity, Switch, StyleSheet, Share } from "react-native";
import t from "../theme/tokens";
import {
  loadState, saveState, addCustomFeed, removeCustomFeed, saveTimerMinutes,
} from "../../vendor/player/src/lib/store";
import { parseOpml, buildOpml } from "../platform/opml";
import { formatTime } from "../../vendor/player/src/lib/engine";
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
// Sentinel timer value: "all night" — no fade/stop, auto-advance through the
// lineup. -1 (never a real minute count).
export const ALL_NIGHT = -1;
const KEY_ALL_NIGHT = "sleepcast2.allnight";
const TIMERS = [5, 45, 60, ALL_NIGHT];

/** Whether the persisted timer selection is "all night". App uses this so a
 *  resumed night keeps all-night mode (the vendor timer store can't hold -1). */
export function isAllNightSelected(): boolean {
  return localStorage.getItem(KEY_ALL_NIGHT) === "1";
}

interface SetupProps {
  onStart: (strategy: "shuffle" | "spread" | "varied", minutes: number) => void;
  onResume?: () => void;
  resumeAvailable?: boolean;
  onOpenRest?: () => void;
  // Set while a podcast night is playing but the listener has gone back home;
  // renders a banner that taps back into the player. Playback is untouched.
  // `allNight` shows "all night" instead of a countdown.
  nowPlaying?: { title: string; remaining: number; allNight?: boolean };
  onReturnToPlayer?: () => void;
  // Fired whenever the enabled feed set changes (toggle/add/remove). App rebuilds
  // the episode pool in response — it is built once at mount, so without this the
  // pool would keep only the feeds that were enabled at launch.
  onFeedsChanged?: () => void;
}

export default function SetupScreen({ onStart, onResume, resumeAvailable, onOpenRest, nowPlaying, onReturnToPlayer, onFeedsChanged }: SetupProps) {
  const [state, setState] = useState<AppState>(() => loadState());
  const [url, setUrl] = useState("");
  // All-night persists via its own flag: the vendor saveTimerMinutes clamps to a
  // real minute range, so it can't store the -1 sentinel. On mount, an set flag
  // wins over the last numeric timer.
  const [minutes, setMinutes] = useState(
    () => (localStorage.getItem(KEY_ALL_NIGHT) === "1" ? ALL_NIGHT : state.settings.timerMinutes)
  );
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
    onFeedsChanged?.();
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
      try { persist(addCustomFeed(state, resolved.feedUrl, undefined)); setUrl(""); onFeedsChanged?.(); } catch { /* invalid url: leave text for correction */ }
      return;
    }
    try { persist(addCustomFeed(state, trimmed)); setUrl(""); onFeedsChanged?.(); } catch { /* invalid url: leave text for correction */ }
  }
  function removeFeed(id: string) { persist(removeCustomFeed(state, id)); onFeedsChanged?.(); }
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
  function pickTimer(m: number) {
    setMinutes(m);
    if (m === ALL_NIGHT) {
      localStorage.setItem(KEY_ALL_NIGHT, "1"); // vendor saveTimerMinutes can't hold -1
    } else {
      localStorage.removeItem(KEY_ALL_NIGHT);
      saveTimerMinutes(m);
    }
  }

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
      {nowPlaying && (
        <TouchableOpacity
          testID="now-playing-banner"
          style={s.banner}
          activeOpacity={t.ios ? 0.6 : 0.2}
          onPress={onReturnToPlayer}
          accessibilityRole="button"
          accessibilityLabel={`return to now playing, ${nowPlaying.title}, ${nowPlaying.allNight ? "all night" : `${formatTime(nowPlaying.remaining)} remaining`}`}
        >
          <Text style={s.bannerLabel}>♪ now playing</Text>
          <Text style={s.bannerTitle} numberOfLines={1}>{nowPlaying.title}</Text>
          <Text style={s.bannerTime}>{nowPlaying.allNight ? "all night" : formatTime(nowPlaying.remaining)}  ›</Text>
        </TouchableOpacity>
      )}
      {showStepBack && (
        <View testID="stepback-offer" style={s.stepback}>
          <Text style={s.sbTitle}>you've been falling asleep quickly for a while.</Text>
          <Text style={s.sbBody}>you might not need us right now — we can stop nudging and stay out of the way for a month.</Text>
          <View style={s.row}>
            <TouchableOpacity testID="stepback-accept" accessibilityRole="button" accessibilityLabel="go quiet" style={s.btn} activeOpacity={t.ios ? 0.6 : 0.2} onPress={acceptStepBack}><Text style={s.btnT}>go quiet</Text></TouchableOpacity>
            <TouchableOpacity testID="stepback-decline" accessibilityRole="button" accessibilityLabel="not now" style={s.btn} activeOpacity={t.ios ? 0.6 : 0.2} onPress={declineStepBack}><Text style={s.btnT}>not now</Text></TouchableOpacity>
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
                activeOpacity={t.ios ? 0.6 : 0.2}
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
              activeOpacity={t.ios ? 0.6 : 0.2}
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
              activeOpacity={t.ios ? 0.6 : 0.2}
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
        <TouchableOpacity testID="add-feed" accessibilityRole="button" accessibilityLabel="add feed" style={s.btn} activeOpacity={t.ios ? 0.6 : 0.2} onPress={addFeed}><Text style={s.btnT}>add</Text></TouchableOpacity>
      </View>
      {feedError && (
        <Text testID="feed-error" style={s.feedError} accessibilityRole="alert" accessibilityLiveRegion="polite">{feedError}</Text>
      )}
      <View style={s.addRow}>
        <TouchableOpacity testID="opml-import" accessibilityRole="button" accessibilityLabel="import OPML file" style={s.btn} activeOpacity={t.ios ? 0.6 : 0.2} onPress={() => importOpml("")}><Text style={s.btnT}>import OPML</Text></TouchableOpacity>
        <TouchableOpacity testID="opml-export" accessibilityRole="button" accessibilityLabel="export OPML file" style={s.btn} activeOpacity={t.ios ? 0.6 : 0.2} onPress={exportOpml}><Text style={s.btnT}>export OPML</Text></TouchableOpacity>
      </View>

      <Text style={s.h}>timer</Text>
      <View style={s.row}>
        {TIMERS.map((m) => {
          const all = m === ALL_NIGHT;
          return (
            <TouchableOpacity
              key={m}
              testID={all ? "timer-all-night" : `timer-${m}`}
              accessibilityRole="button"
              accessibilityLabel={all ? "all night timer, plays until you stop" : `${m} minute timer`}
              accessibilityState={{ selected: minutes === m }}
              style={[s.chip, minutes === m && s.chipOn]}
              activeOpacity={t.ios ? 0.6 : 0.2}
              onPress={() => pickTimer(m)}
            >
              <Text style={s.btnT}>{all ? "all night" : `${m}m`}</Text>
            </TouchableOpacity>
          );
        })}
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
        <TouchableOpacity testID="start-shuffle" accessibilityRole="button" accessibilityLabel="start — shuffle" disabled={mixed} style={s.btn} activeOpacity={t.ios ? 0.6 : 0.2} onPress={() => startIfNotMixed("shuffle", minutes)}><Text style={s.btnT}>shuffle</Text></TouchableOpacity>
        <TouchableOpacity testID="start-spread" accessibilityRole="button" accessibilityLabel="start — spread" disabled={mixed} style={s.btn} activeOpacity={t.ios ? 0.6 : 0.2} onPress={() => startIfNotMixed("spread", minutes)}><Text style={s.btnT}>spread</Text></TouchableOpacity>
        <TouchableOpacity testID="start-varied" accessibilityRole="button" accessibilityLabel="start — varied" disabled={mixed} style={s.btn} activeOpacity={t.ios ? 0.6 : 0.2} onPress={() => startIfNotMixed("varied", minutes)}><Text style={s.btnT}>varied</Text></TouchableOpacity>
      </View>
      {resumeAvailable && (
        <TouchableOpacity testID="start-resume" accessibilityRole="button" accessibilityLabel="resume last night" style={s.btn} activeOpacity={t.ios ? 0.6 : 0.2} onPress={onResume}><Text style={s.btnT}>resume last night</Text></TouchableOpacity>
      )}

      {onOpenRest && (
        <TouchableOpacity testID="open-rest" accessibilityRole="link" accessibilityLabel="sleep history" activeOpacity={t.ios ? 0.6 : 0.2} onPress={onOpenRest} style={s.nightsLink}>
          <Text style={s.nightsText}>nights ›</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

// Android/foss stays byte-for-byte on the pre-refactor literal styles (frozen);
// only iOS gets the tokenized/polished styles. Keep androidStyles verbatim —
// do not edit its values when touching iOS styling.
const androidStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050508" },
  body: { padding: 24, gap: 12 },
  banner: { alignSelf: "stretch", borderWidth: 1, borderColor: "#6f6a62", borderRadius: 12, backgroundColor: "#12100c", paddingHorizontal: 16, paddingVertical: 12, gap: 2 },
  bannerLabel: { color: "#8a7a5c", fontSize: 11, textTransform: "uppercase" },
  bannerTitle: { color: "#d9c9a8", fontSize: 15 },
  bannerTime: { color: "#9a875f", fontSize: 13 },
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

const iosStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.color.ground },
  body: { padding: t.space(6), gap: t.space(3) },
  banner: { alignSelf: "stretch", ...t.surface.panel, paddingHorizontal: t.space(4), paddingVertical: t.space(3), gap: t.space(1) },
  bannerLabel: { color: t.color.label, ...t.type.micro },
  bannerTitle: { color: t.color.textPrimary, ...t.type.bodySm },
  bannerTime: { color: t.color.label, ...t.type.label, ...t.tabular },
  h: { color: t.color.label, ...t.type.micro, marginTop: t.space(3) },
  feedRowContainer: { flexDirection: "column", gap: t.space(1.5) },
  feedRow: { flexDirection: "row", alignItems: "center", gap: t.space(2.5) },
  feedTitle: { color: t.color.textSecondary, flex: 1, ...t.type.bodySm },
  remove: { color: t.color.accent, fontSize: 16, paddingHorizontal: t.space(1.5) },
  trimRow: { flexDirection: "row", alignItems: "center", gap: t.space(2.5) },
  trimBtn: { borderWidth: 1, borderColor: t.color.hairline, borderRadius: t.radius.pill, minWidth: 30, minHeight: 30, alignItems: "center", justifyContent: "center" },
  trimBtnT: { color: t.color.textPrimary, fontSize: 16 },
  trimVal: { color: t.color.textMuted, ...t.type.label, ...t.tabular, minWidth: 44, textAlign: "center" },
  addRow: { flexDirection: "row", gap: t.space(2), alignItems: "center" },
  input: { flex: 1, color: t.color.textPrimary, borderWidth: 1, borderColor: t.color.hairline, borderRadius: t.radius.sm, paddingHorizontal: t.space(3), paddingVertical: t.space(2), ...t.type.body },
  feedError: { color: t.color.accent, ...t.type.label },
  mixWarning: { color: t.color.accent, ...t.type.label, marginBottom: t.space(1) },
  row: { flexDirection: "row", gap: t.space(2.5), flexWrap: "wrap" },
  qhRow: { flexDirection: "row", alignItems: "center", gap: t.space(2.5) },
  qhLabel: { color: t.color.textSecondary, flex: 1, ...t.type.label },
  chip: { borderWidth: 1, borderColor: t.color.hairline, borderRadius: t.radius.pill, paddingHorizontal: t.space(3.5), paddingVertical: t.space(2) },
  chipOn: { borderColor: t.color.textPrimary, backgroundColor: t.ios ? t.color.surfaceRaised : undefined },
  btn: { borderWidth: 1, borderColor: t.color.hairline, borderRadius: t.radius.pill, paddingHorizontal: t.space(4.5), paddingVertical: t.space(2.5) },
  btnT: { color: t.color.textPrimary, ...t.type.label },
  nightsLink: { marginTop: t.space(3) },
  nightsText: { color: t.color.label, ...t.type.label },
  stepback: { alignSelf: "stretch", ...t.surface.panel, gap: t.space(2) },
  sbTitle: { color: t.color.textPrimary, ...t.type.bodySm },
  sbBody: { color: t.color.textMuted, ...t.type.label },
});

const s = t.ios ? iosStyles : androidStyles;
