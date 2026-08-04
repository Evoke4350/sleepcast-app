import type { Episode } from "../../vendor/player/src/lib/engine";
import { parseFeedXml } from "../../vendor/player/src/lib/engine";
import { loadState, cacheFeedXml, getCachedFeedXml } from "../../vendor/player/src/lib/store";

export type XmlFetcher = (url: string) => Promise<string>;

export interface PoolResult {
  pool: Episode[];
  feedTitles: Record<string, string>;
  errors: string[];
}

export async function buildPool(fetchXml: XmlFetcher): Promise<PoolResult> {
  const feeds = loadState().feeds.filter((f) => f.enabled);
  const pool: Episode[] = [];
  const feedTitles: Record<string, string> = {};
  const errors: string[] = [];

  await Promise.all(
    feeds.map(async (f) => {
      let xml: string | null = null;
      try {
        xml = await fetchXml(f.url);
        cacheFeedXml(f.id, xml);
      } catch {
        xml = getCachedFeedXml(f.id); // offline path
      }
      if (!xml) {
        errors.push(`${f.title || f.url}: no network and no cache`);
        return;
      }
      try {
        const feed = parseFeedXml(xml, f.id);
        feedTitles[f.id] = feed.title || f.title;
        pool.push(...feed.episodes);
      } catch (e) {
        errors.push(`${f.title || f.url}: ${(e as Error).message}`);
      }
    })
  );

  return { pool, feedTitles, errors };
}
