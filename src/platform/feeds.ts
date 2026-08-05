import type { Episode } from "../../vendor/player/src/lib/engine";
import { parseFeedFor } from "./youtube";
import { loadState, cacheFeedXml, getCachedFeedXml } from "../../vendor/player/src/lib/store";

export type XmlFetcher = (url: string) => Promise<string>;

export interface PoolResult {
  pool: Episode[];
  feedTitles: Record<string, string>;
  errors: string[];
}

export async function buildPool(fetchXml: XmlFetcher): Promise<PoolResult> {
  const feeds = loadState().feeds.filter((f) => f.enabled);

  // Fetch concurrently but assemble in feed order, so the pool (and therefore a
  // seeded spread) is reproducible rather than dependent on network timing.
  type FeedResult =
    | { id: string; title: string; episodes: Episode[] }
    | { error: string };

  const results = await Promise.all(
    feeds.map(async (f): Promise<FeedResult> => {
      let xml: string | null = null;
      try {
        xml = await fetchXml(f.url);
        cacheFeedXml(f.id, xml);
      } catch {
        xml = getCachedFeedXml(f.id); // offline path
      }
      if (!xml) {
        return { error: `${f.title || f.url}: no network and no cache` };
      }
      try {
        const feed = parseFeedFor(xml, f.id, f.url);
        return { id: f.id, title: feed.title || f.title, episodes: feed.episodes };
      } catch (e) {
        return { error: `${f.title || f.url}: ${(e as Error).message}` };
      }
    })
  );

  const pool: Episode[] = [];
  const feedTitles: Record<string, string> = {};
  const errors: string[] = [];
  for (const r of results) {
    if ("error" in r) {
      errors.push(r.error);
    } else {
      feedTitles[r.id] = r.title;
      pool.push(...r.episodes);
    }
  }

  return { pool, feedTitles, errors };
}
