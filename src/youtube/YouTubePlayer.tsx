// Renders the YouTube IFrame player (Google's embedded player, via a
// WebView — see docs/specs/2026-08-05-youtube-source-design.md for why: a
// YouTube episode has no streamable URL, so the IFrame embed is the only
// lawful way to play one) and exposes a `createPlayer` that YouTubeMedia
// (vendor/player/src/lib/youtube-media.ts) can drive as its synchronous
// YTPlayerLike.
//
// react-native-youtube-iframe@2.4.1's real ref API (checked against
// node_modules/react-native-youtube-iframe/{index.d.ts,src/YoutubeIframe.js}
// — see task-s6-5-report.md) is NOT a mirror of YTPlayerLike:
//   - getCurrentTime()/getDuration() ARE async (Promise<number>) — matches.
//   - There is no getPlayerState(); state only arrives via the onChangeState
//     callback (a PLAYER_STATES string, not a number).
//   - There is no playVideo/pauseVideo/setVolume/loadVideoById/destroy on the
//     ref at all. Play/pause, volume, and which video is loaded are all
//     *props* (`play`, `volume`, `videoId`) that the component's own
//     useEffects translate into postMessage/injectJavaScript calls into the
//     WebView. So this component drives those via local state instead of
//     imperative ref calls.
//   - The ref does expose `seekTo(seconds, allowSeekAhead)`, which is used to
//     honor `startSeconds` on load (the library's own videoId-change effect
//     calls loadVideoById/cueVideoById with no start-time argument, so a
//     seek after the load is the only way to land on a non-zero offset).
//   - destroy() has no equivalent — a mounted WebView is only freed by
//     unmounting. Our destroy() therefore stops issuing commands and clears
//     the pump interval; the parent (YouTubeNightScreen, Task 6) is
//     responsible for unmounting this component when the night ends.
//
// Autoplay is blocked on-device (confirmed in the Task 4 link-gate report):
// setting `play` true does not start audio without a prior user gesture. So
// playVideo() here is deliberately just "set the play prop true" — a
// no-op-safe call — and Task 6's tap-to-begin gesture is what makes that
// meaningful; this component neither requires nor assumes the gesture
// happened.
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import YoutubeIframe, {
  PLAYER_ERRORS,
  PLAYER_STATES,
  type YoutubeIframeRef,
} from "react-native-youtube-iframe";
import type { WebViewProps } from "react-native-webview";
import type { CreatePlayerArgs, YTPlayerLike } from "../../vendor/player/src/lib/youtube-media";
import { makeYtAdapter, type AsyncPlayerCtl } from "./ytPlayerAdapter";

/** How often the cache adapter re-reads getCurrentTime/getDuration from the
 *  WebView. The fade samples ~1s, so this is ample headroom. */
const PUMP_INTERVAL_MS = 250;

/** YT's own numeric state codes (see YTPlayerLike.getPlayerState's doc),
 *  keyed by the library's string states. */
const STATE_CODES: Record<PLAYER_STATES, number> = {
  [PLAYER_STATES.UNSTARTED]: -1,
  [PLAYER_STATES.ENDED]: 0,
  [PLAYER_STATES.PLAYING]: 1,
  [PLAYER_STATES.PAUSED]: 2,
  [PLAYER_STATES.BUFFERING]: 3,
  [PLAYER_STATES.VIDEO_CUED]: 5,
};

/** YT's own numeric error codes (classifyYouTubeError's domain), keyed by the
 *  library's string error names. 101 and 150 both surface as
 *  EMBED_NOT_ALLOWED from this library; classifyYouTubeError treats them
 *  identically, so collapsing to 101 loses nothing. Keyed as Record<string,
 *  ...> (not Record<PLAYER_ERRORS, ...>) because the library's onError prop
 *  is typed `(error: string) => void`, not the enum. */
const ERROR_CODES: Record<string, number> = {
  [PLAYER_ERRORS.INVALID_PARAMETER]: 2,
  [PLAYER_ERRORS.HTML5_ERROR]: 5,
  [PLAYER_ERRORS.VIDEO_NOT_FOUND]: 100,
  [PLAYER_ERRORS.EMBED_NOT_ALLOWED]: 101,
};

export interface YouTubePlayerHandle {
  /** Matches CreatePlayerArgs => YTPlayerLike, the shape YouTubeMedia's
   *  constructor wants. Usage (Task 6):
   *    const ref = useRef<YouTubePlayerHandle>(null);
   *    const media = new YouTubeMedia((args) => ref.current!.createPlayer(args), handlers);
   *  Only meaningful once this component has mounted (ref attached, i.e.
   *  inside an effect, not during render). */
  createPlayer(args: CreatePlayerArgs): YTPlayerLike;
}

interface YouTubePlayerProps {
  height?: number;
  /** Forwarded straight to the underlying react-native-webview instance
   *  (react-native-youtube-iframe passes this prop through verbatim). Task 6
   *  uses it to try to permit autoplay — `mediaPlaybackRequiresUserAction:
   *  false` + `allowsInlineMediaPlayback: true` — since the device gate
   *  found autoplay blocked without them. Still not guaranteed by every OS/
   *  webview version, which is why Task 6 also renders a tap-to-begin
   *  fallback rather than relying on this alone. */
  webViewProps?: WebViewProps;
}

const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(function YouTubePlayer(
  { height = 220, webViewProps },
  ref,
) {
  const [videoId, setVideoId] = useState<string | undefined>(undefined);
  const [play, setPlay] = useState(false);
  const [volume, setVolume] = useState(100);

  const iframeRef = useRef<YoutubeIframeRef | null>(null);
  const argsRef = useRef<CreatePlayerArgs | null>(null);
  const startSecondsRef = useRef(0);
  const destroyedRef = useRef(false);
  const setStateRef = useRef<((code: number) => void) | null>(null);
  const pumpTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPump = useCallback(() => {
    if (pumpTimerRef.current != null) {
      clearInterval(pumpTimerRef.current);
      pumpTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopPump, [stopPump]);

  useImperativeHandle(
    ref,
    () => ({
      createPlayer(args: CreatePlayerArgs): YTPlayerLike {
        argsRef.current = args;
        startSecondsRef.current = args.startSeconds ?? 0;
        destroyedRef.current = false;
        setVideoId(args.videoId);

        const ctl: AsyncPlayerCtl = {
          getCurrentTime: async () => {
            if (destroyedRef.current || !iframeRef.current) return 0;
            try {
              return await iframeRef.current.getCurrentTime();
            } catch {
              return 0;
            }
          },
          getDuration: async () => {
            if (destroyedRef.current || !iframeRef.current) return 0;
            try {
              return await iframeRef.current.getDuration();
            } catch {
              return 0;
            }
          },
          play: () => {
            if (!destroyedRef.current) setPlay(true);
          },
          pause: () => {
            if (!destroyedRef.current) setPlay(false);
          },
          setVolume: (pct: number) => {
            if (!destroyedRef.current) setVolume(pct);
          },
          load: (id: string, start?: number) => {
            if (destroyedRef.current) return;
            startSecondsRef.current = start ?? 0;
            setVideoId(id);
            if (start) iframeRef.current?.seekTo(start, true);
          },
          destroy: () => {
            destroyedRef.current = true;
            setPlay(false);
            stopPump();
          },
        };

        const adapter = makeYtAdapter(ctl);
        setStateRef.current = adapter.setState;

        stopPump();
        pumpTimerRef.current = setInterval(() => {
          adapter.pump().catch(() => {});
        }, PUMP_INTERVAL_MS);

        return adapter.player;
      },
    }),
    [stopPump],
  );

  const onReady = useCallback(() => {
    if (startSecondsRef.current > 0) iframeRef.current?.seekTo(startSecondsRef.current, true);
    argsRef.current?.onReady();
  }, []);

  const onChangeState = useCallback((state: PLAYER_STATES) => {
    setStateRef.current?.(STATE_CODES[state]);
    if (state === PLAYER_STATES.ENDED) argsRef.current?.onEnded();
  }, []);

  const onError = useCallback((error: string) => {
    argsRef.current?.onError(ERROR_CODES[error] ?? -1);
  }, []);

  return (
    <View style={[styles.root, { height }]} testID="youtube-player">
      {videoId ? (
        <YoutubeIframe
          ref={iframeRef}
          height={height}
          videoId={videoId}
          play={play}
          volume={volume}
          webViewProps={webViewProps}
          onReady={onReady}
          onChangeState={onChangeState}
          onError={onError}
        />
      ) : null}
    </View>
  );
});

export default YouTubePlayer;

const styles = StyleSheet.create({
  root: { backgroundColor: "#050508" },
});
