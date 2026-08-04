import type { Episode } from "../../vendor/player/src/lib/engine";
import { diverseByMeta, rearmMinutes } from "../../vendor/player/src/lib/engine";
import { pickNextEpisode } from "../../vendor/player/src/lib/plays";
import { diversePick } from "../../vendor/player/src/lib/semantic-math";
import { getPlays, loadLastNight, REARM_WINDOW_MS } from "../../vendor/player/src/lib/store";
import { nextInSpread } from "../../vendor/player/src/lib/rest/reanchor";
import { embedTexts as prodEmbed } from "../platform/embed";

export type Strategy = "shuffle" | "spread" | "varied";
export interface Lineup { lead: Episode; lineup: Episode[]; wasVaried: boolean; }
export interface Resume { lead: Episode; minutes: number; }
export interface Deps {
  embed?: (t: string[], onProgress?: (done: number, total: number) => void) => Promise<Float32Array[]>;
  rand?: () => number;
  now?: () => number;
  timeoutMs?: number;
}

const EMBED_CAP = 96;
const VARIED_N = 8;
const TIMEOUT = 25_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("embed-timeout")), ms);
    p.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
  });
}

export async function chooseLineup(strategy: Strategy, pool: Episode[], deps: Deps = {}): Promise<Lineup | null> {
  if (!pool.length) return null;
  const rand = deps.rand ?? Math.random;

  if (strategy === "shuffle") {
    const lead = pickNextEpisode(pool, getPlays(), rand);
    return lead ? { lead, lineup: [lead], wasVaried: false } : null;
  }
  if (strategy === "spread") {
    const lineup = diverseByMeta(pool, VARIED_N, rand);
    return { lead: lineup[0], lineup, wasVaried: false };
  }
  // varied
  const embed = deps.embed ?? prodEmbed;
  const candidates = pool.length > EMBED_CAP ? diverseByMeta(pool, EMBED_CAP, rand) : pool;
  try {
    const vecs = await withTimeout(embed(candidates.map((e) => e.title)), deps.timeoutMs ?? TIMEOUT);
    const lineup = diversePick(vecs, VARIED_N, rand).map((i) => candidates[i]);
    return { lead: lineup[0], lineup, wasVaried: true };
  } catch {
    const lineup = diverseByMeta(pool, VARIED_N, rand); // Lockdown/slow-device path
    return { lead: lineup[0], lineup, wasVaried: true };
  }
}

export function resumeNight(previousMinutes: number, deps: Deps = {}): Resume | null {
  const now = deps.now ?? (() => Date.now());
  const last = loadLastNight();
  if (!last || now() - last.endedAt > REARM_WINDOW_MS) return null;
  const lead = nextInSpread(last.pool, last.playedIds);
  if (!lead) return null;
  return { lead, minutes: rearmMinutes(previousMinutes) };
}
