// Bridges an async player control surface (react-native-youtube-iframe's ref,
// wired up by YouTubePlayer.tsx) to the vendor's synchronous YTPlayerLike
// (vendor/player/src/lib/youtube-media.ts). YouTubeMedia calls
// getCurrentTime()/getDuration()/getPlayerState() expecting a number back
// immediately — it cannot await. So this caches the latest value seen from
// each async source and serves the cache synchronously; a caller (the
// component's 250ms interval) is responsible for keeping the cache fresh via
// pump(), and for pushing state transitions in via setState() as they arrive
// from onChangeState.
import type { YTPlayerLike } from "../../vendor/player/src/lib/youtube-media";

/** What YouTubePlayer.tsx must supply: async reads plus imperative writes,
 *  shaped around whatever the underlying library actually exposes rather
 *  than mirroring YTPlayerLike 1:1 (react-native-youtube-iframe controls
 *  play/pause/volume/video via props, not ref methods — see YouTubePlayer.tsx). */
export interface AsyncPlayerCtl {
  getCurrentTime(): Promise<number>;
  getDuration(): Promise<number>;
  play(): void;
  pause(): void;
  setVolume(pct: number): void;
  load(videoId: string, start?: number): void;
  destroy(): void;
}

export interface YtAdapter {
  player: YTPlayerLike;
  /** Refreshes the cached currentTime/duration from the async ctl. Call on a
   *  ~250ms interval — the fade samples ~1s, so this is ample headroom. */
  pump(): Promise<void>;
  /** Records the latest YT numeric state code (-1/0/1/2/3/5), pushed in from
   *  onChangeState. Not polled — YT only tells you on change. */
  setState(code: number): void;
}

/** Unstarted, matching YT's own default and what youtube-media.ts expects
 *  before a player is ready. */
const UNSTARTED = -1;

export function makeYtAdapter(ctl: AsyncPlayerCtl): YtAdapter {
  let currentTime = 0;
  let duration = 0;
  let state = UNSTARTED;

  const player: YTPlayerLike = {
    getCurrentTime: () => currentTime,
    getDuration: () => duration,
    getPlayerState: () => state,
    playVideo: () => ctl.play(),
    pauseVideo: () => ctl.pause(),
    setVolume: (percent: number) => ctl.setVolume(percent),
    loadVideoById: (videoId: string, startSeconds?: number) => ctl.load(videoId, startSeconds),
    destroy: () => ctl.destroy(),
  };

  return {
    player,
    pump: async () => {
      const [t, d] = await Promise.all([ctl.getCurrentTime(), ctl.getDuration()]);
      currentTime = t;
      duration = d;
    },
    setState: (code: number) => {
      state = code;
    },
  };
}
