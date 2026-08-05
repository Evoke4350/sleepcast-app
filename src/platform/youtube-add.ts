import { youtubeFeedUrl } from "./youtube-url";
import { youtubeHandleUrl, channelIdFromHtml } from "../../vendor/player/src/lib/youtube-resolve";

export type YouTubeAdd = { ok: true; feedUrl: string } | { ok: false; reason: "video" | "unresolved" | "not-youtube" };

const defaultFetch = (url: string) => fetch(url).then((r) => r.text());

export async function resolveYouTubeFeedUrl(
  input: string,
  fetchText: (url: string) => Promise<string> = defaultFetch,
): Promise<YouTubeAdd> {
  const yt = youtubeFeedUrl(input);
  if (!yt) return { ok: false, reason: "not-youtube" };
  if (yt.kind === "feed") return { ok: true, feedUrl: yt.url };
  if (yt.kind === "unsupported") return { ok: false, reason: "video" };
  // handle → fetch the channel page → channel id → feed url
  const pageUrl = youtubeHandleUrl(yt.handle);
  if (!pageUrl) return { ok: false, reason: "unresolved" };
  try {
    const html = await fetchText(pageUrl);
    const id = channelIdFromHtml(html);
    if (!id) return { ok: false, reason: "unresolved" };
    return { ok: true, feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${id}` };
  } catch {
    return { ok: false, reason: "unresolved" };
  }
}
