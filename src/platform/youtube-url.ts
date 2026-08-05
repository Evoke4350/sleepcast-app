// The pure YouTube-URL helpers, reimplemented natively.
//
// The vendor `youtube.ts` exports these same pure functions, but the same file
// also holds `parseYouTubeFeed` — a DOMParser/`getElementsByTagName`/`children`
// implementation that does not typecheck (no DOM lib) or run on React Native.
// Importing anything from it pulls that browser code into the TS program and
// breaks `tsc`. So, exactly as `src/platform/feed.ts`/`opml.ts`/`logic/trim.ts`
// do, the pure part is carried here — a verbatim copy of the vendor helpers so
// the two cannot drift. (`youtube-resolve.ts` is pure and is imported directly.)

/** Hosts whose /channel and /playlist URLs we will turn into a feed. Matched
 *  as whole hostnames — a substring test would accept youtube.com.evil.test. */
const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

export type YouTubeUrl =
  | { kind: "feed"; url: string }
  | { kind: "handle"; handle: string }
  | { kind: "unsupported"; reason: "video" };

const feedFor = (param: "channel_id" | "playlist_id", id: string) =>
  `https://www.youtube.com/feeds/videos.xml?${param}=${id}`;

/**
 * What a pasted YouTube URL means, or null if it is not YouTube and belongs to
 * the normal podcast path.
 */
export function youtubeFeedUrl(input: string): YouTubeUrl | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (!YT_HOSTS.has(url.hostname.toLowerCase())) return null;

  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/feeds/videos.xml") {
    const channel = url.searchParams.get("channel_id");
    if (channel) return { kind: "feed", url: feedFor("channel_id", channel) };
    const playlist = url.searchParams.get("playlist_id");
    if (playlist) return { kind: "feed", url: feedFor("playlist_id", playlist) };
    return null;
  }

  const channel = path.match(/^\/channel\/([A-Za-z0-9_-]+)$/);
  if (channel) return { kind: "feed", url: feedFor("channel_id", channel[1]) };

  if (path === "/playlist") {
    const list = url.searchParams.get("list");
    if (list) return { kind: "feed", url: feedFor("playlist_id", list) };
    return null;
  }

  const handle = path.match(/^\/@([A-Za-z0-9._-]+)/);
  if (handle) return { kind: "handle", handle: handle[1] };

  if (path === "/watch" || path.startsWith("/shorts/")) {
    return { kind: "unsupported", reason: "video" };
  }

  return null;
}

/** True for a feed URL this module produced — the player uses it to decide
 *  which playback backend an episode needs. */
export function isYouTubeFeedUrl(url: string): boolean {
  const parsed = youtubeFeedUrl(url);
  return parsed?.kind === "feed";
}
