// OPML parsing for React Native.
//
// The shared vendor/player/src/lib/opml.ts parses with DOMParser and
// querySelector — not available on React Native. This reproduces the same
// OpmlFeed[] shape from the same OPML XML using fast-xml-parser, mirroring
// the approach in feed.ts. buildOpml has no DOM dependency and is ported
// verbatim.
import { XMLParser } from "fast-xml-parser";

export interface OpmlFeed {
  url: string;
  title: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

/** fast-xml-parser hands back an object for a single <outline> child and an
 *  array for multiple — normalise to an array before iterating. */
function asArray(node: unknown): Record<string, unknown>[] {
  if (node === undefined || node === null) return [];
  return Array.isArray(node) ? (node as Record<string, unknown>[]) : [node as Record<string, unknown>];
}

function attr(node: Record<string, unknown>, name: string): string | undefined {
  const v = node[`@_${name}`];
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed || undefined;
  }
  return undefined;
}

// Recursive over <outline>: any outline carrying xmlUrl is a feed, wrapper
// outlines (folders) are traversed.
export function parseOpml(xml: string): OpmlFeed[] {
  const doc = parser.parse(xml) as Record<string, any>;
  if (!doc || typeof doc !== "object" || !("opml" in doc)) {
    throw new Error("not an OPML document");
  }

  const feeds: OpmlFeed[] = [];
  const walk = (node: Record<string, unknown>) => {
    for (const outline of asArray(node.outline)) {
      const url = attr(outline, "xmlUrl");
      if (url) {
        const title = attr(outline, "text") ?? attr(outline, "title") ?? null;
        feeds.push({ url, title });
      }
      walk(outline);
    }
  };

  const body = doc.opml?.body;
  if (body) walk(body as Record<string, unknown>);
  return feeds;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

export function buildOpml(feeds: { url: string; title: string }[]): string {
  const outlines = feeds
    .map(
      (f) =>
        `    <outline type="rss" text="${escapeAttr(f.title)}" xmlUrl="${escapeAttr(f.url)}" />`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>sleepcast feeds</title></head>
  <body>
${outlines}
  </body>
</opml>
`;
}
