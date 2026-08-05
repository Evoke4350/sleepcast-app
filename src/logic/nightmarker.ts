import type { Episode } from "../../vendor/player/src/lib/engine";
import { recordHeardPlay, saveLastNight } from "../../vendor/player/src/lib/store";
import { HEARD_SEC } from "../../vendor/player/src/lib/plays";
import { appendNight } from "../../vendor/player/src/lib/rest/ledger";

export interface LiveMarker {
  episodeId: string; startedAt: number; timerMinutes: number;
  lineup: Episode[]; playedIds: string[]; feedTitles: Record<string, string>; wasVaried: boolean;
}

const KEY = "sleepcast2.livenight";

export function saveMarker(m: LiveMarker): void {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* quota */ }
}
export function loadMarker(): LiveMarker | null {
  try { const raw = localStorage.getItem(KEY); if (!raw) return null; const m = JSON.parse(raw) as LiveMarker; return m?.episodeId ? m : null; } catch { return null; }
}
export function clearMarker(): void { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

// The process died before onNightEnded could fire. Reconstruct the ledger from
// the marker as if the night had faded at its scheduled end.
export function reconcileToLastNight(m: LiveMarker, now: number): void {
  const ep = m.lineup.find((e) => e.id === m.episodeId);
  const heardSec = Math.min(m.timerMinutes * 60, Math.round((now - m.startedAt) / 1000));
  if (ep && heardSec >= HEARD_SEC) {
    recordHeardPlay({ id: ep.id, title: ep.title, feedId: ep.feedId, startedAt: m.startedAt, heardSec });
  }
  const playedIds = m.playedIds.includes(m.episodeId) ? m.playedIds : [...m.playedIds, m.episodeId];
  saveLastNight({ pool: m.lineup, playedIds, feedTitles: m.feedTitles, artworkByFeedId: {}, skipIntroByFeedId: {}, endedVia: "faded", endedAt: now, wasVaried: m.wasVaried });
  // The process died mid-night, so no RestSession ever observed it — there's
  // no onset to report. Still record a minimal night so the ledger's night
  // count (and rollup stats that key off it) aren't silently short one entry.
  appendNight({
    startedAt: m.startedAt,
    timerMinutes: m.timerMinutes,
    endedVia: "faded",
    sleptAtMs: null,
    timeToSleepMs: null,
    interactions: 0,
    detector: "none",
  });
  clearMarker();
}
