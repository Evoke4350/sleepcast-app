import "../platform/storage";
import { installLocalStorage } from "../platform/storage";
import { saveMarker, loadMarker, clearMarker, reconcileToLastNight } from "./nightmarker";
import { loadLastNight, getPlays } from "../../vendor/player/src/lib/store";
import type { Episode } from "../../vendor/player/src/lib/engine";

installLocalStorage();
const ep = (id: string): Episode => ({ id, title: id, url: `https://x/${id}.mp3`, feedId: "f", date: "2024-01-01" } as Episode);

test("save/load/clear round-trips the marker", () => {
  const m = { episodeId: "a", startedAt: 1000, timerMinutes: 5, lineup: [ep("a"), ep("b")], playedIds: [], feedTitles: { f: "F" }, wasVaried: false };
  saveMarker(m);
  expect(loadMarker()?.episodeId).toBe("a");
  clearMarker();
  expect(loadMarker()).toBeNull();
});

test("reconcile writes lastNight + a heard play when enough time elapsed, then clears", () => {
  const m = { episodeId: "a", startedAt: 1000, timerMinutes: 5, lineup: [ep("a"), ep("b")], playedIds: [], feedTitles: { f: "F" }, wasVaried: false };
  saveMarker(m);
  reconcileToLastNight(m, 1000 + 5 * 60_000); // a full timer later
  const last = loadLastNight();
  expect(last?.playedIds).toContain("a");
  expect(last?.endedVia).toBe("faded");
  expect(getPlays().some((p) => p.id === "a")).toBe(true);
  expect(loadMarker()).toBeNull(); // cleared
});

test("reconcile below HEARD_SEC still writes lastNight but records no heard play, then clears", () => {
  const m = { episodeId: "a", startedAt: 1000, timerMinutes: 5, lineup: [ep("a"), ep("b")], playedIds: [], feedTitles: { f: "F" }, wasVaried: false };
  saveMarker(m);
  reconcileToLastNight(m, 1000 + 30_000); // only 30s elapsed, well under HEARD_SEC (120s)
  const last = loadLastNight();
  expect(last?.playedIds).toContain("a"); // still anchors resume-after-fade
  expect(last?.endedVia).toBe("faded");
  expect(getPlays().some((p) => p.id === "a")).toBe(false); // not heard long enough to count as a play
  expect(loadMarker()).toBeNull(); // cleared
});
