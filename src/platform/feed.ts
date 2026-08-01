// Feed parsing for React Native.
//
// The shared engine.ts parses with DOMParser and querySelector. No React
// Native XML library implements that surface faithfully — @xmldom/xmldom has
// no querySelector — and shimming a DOM is more work than the parser. So this
// produces the same Feed/Episode shape from the same RSS, and the shared
// parseFeedXml is simply not used on this platform.
//
// The contract to hold, because the rest of the shared code assumes it:
//   - an item with no enclosure url is skipped entirely
//   - id falls back to the url when guid is absent
//   - title falls back to "untitled", date to ""
import { XMLParser } from "fast-xml-parser";
import type { Episode, Feed } from "../../vendor/player/src/lib/engine";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Feeds are wildly inconsistent about whether a single-item channel is an
  // array. Forcing these to arrays removes a whole class of "works on one feed,
  // crashes on another" bug.
  isArray: (name) => name === "item",
  trimValues: true,
});

/** RSS text nodes arrive as string, number, or {"#text": ...} depending on
 *  content. Normalise before trusting anything to be a string. */
function text(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in (node as Record<string, unknown>)) {
    return text((node as Record<string, unknown>)["#text"]);
  }
  return "";
}

function attr(node: unknown, name: string): string | undefined {
  if (node && typeof node === "object") {
    const v = (node as Record<string, unknown>)[`@_${name}`];
    if (typeof v === "string") return v;
  }
  return undefined;
}

export function parseFeed(xmlText: string, feedId: string): Feed {
  const doc = parser.parse(xmlText) as Record<string, any>;
  const channel = doc?.rss?.channel ?? doc?.channel ?? {};
  const title = text(channel.title) || "feed";

  const episodes: Episode[] = [];
  for (const item of (channel.item ?? []) as Record<string, unknown>[]) {
    const url = attr(item.enclosure, "url");
    if (!url) continue; // no audio, no episode
    episodes.push({
      id: text(item.guid) || url,
      title: text(item.title) || "untitled",
      url,
      feedId,
      date: text(item.pubDate),
    });
  }

  // itunes:image carries the art in an attribute; the legacy <image><url> form
  // carries it as a child element. Prefer the former, as the shared parser does.
  const artwork =
    attr(channel["itunes:image"], "href") ??
    text((channel.image as Record<string, unknown> | undefined)?.url) ??
    undefined;

  return { id: feedId, title, episodes, artwork: artwork || undefined };
}
