import { XMLParser } from "fast-xml-parser";
import type { Episode, Feed } from "../../vendor/player/src/lib/engine";
import { isYouTubeFeedUrl } from "./youtube-url";
import { parseFeed } from "./feed";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "entry",
  trimValues: true,
});

function text(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in (node as Record<string, unknown>)) {
    return text((node as Record<string, unknown>)["#text"]);
  }
  return "";
}

export function parseYouTubeFeed(xmlText: string, feedId: string): Feed {
  const doc = parser.parse(xmlText) as Record<string, any>;
  const feedNode = doc?.feed ?? {};
  const title = text(feedNode.title) || "YouTube channel";
  const entries: any[] = Array.isArray(feedNode.entry) ? feedNode.entry : feedNode.entry ? [feedNode.entry] : [];

  const episodes: Episode[] = [];
  for (const entry of entries) {
    const idText = text(entry["id"]);
    const videoId =
      text(entry["yt:videoId"]) ||
      idText.match(/^yt:video:([A-Za-z0-9_-]+)$/)?.[1] ||
      "";
    if (!videoId) continue;
    episodes.push({
      id: idText || `yt:video:${videoId}`,
      title: text(entry["title"]) || "untitled",
      url: `https://www.youtube.com/watch?v=${videoId}`,
      feedId,
      date: text(entry["published"]),
      youtubeId: videoId,
    });
  }

  // Channel artwork is the first thumbnail found across all entries (matching
  // the vendor parser), not just the first entry's — early entries can lack one.
  let artwork: string | undefined;
  for (const entry of entries) {
    const thumb = entry?.["media:group"]?.["media:thumbnail"];
    const u = thumb && typeof thumb === "object" ? (thumb["@_url"] as string | undefined) : undefined;
    if (u) { artwork = u; break; }
  }

  return { id: feedId, title, episodes, artwork };
}

export function parseFeedFor(xmlText: string, feedId: string, feedUrl: string): Feed {
  return isYouTubeFeedUrl(feedUrl) ? parseYouTubeFeed(xmlText, feedId) : parseFeed(xmlText, feedId);
}
