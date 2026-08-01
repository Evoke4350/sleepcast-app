import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

// Deliberately small. The app needs to play a URL, set a volume, keep playing
// while backgrounded, and publish Now Playing information. It does not need a
// queue, gapless playback, crossfading, casting or download management — the
// surface a general-purpose audio library carries and that we would then be
// depending on someone else to maintain.
//
// The fade is NOT here. It stays in TypeScript, using fadeVolume from the
// shared player repo, driving setVolume. Keeping the fade curve in tested,
// shared code means both platforms fade identically and the native side stays
// dumb enough to reason about without a compiler.
export interface Spec extends TurboModule {
  /** Load and play a URL, optionally seeking first. Resolves once playback
   *  has been requested, not once it has been heard. */
  play(url: string, startAtSeconds: number): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  /** 0..1. Called about once a second by the fade. */
  setVolume(volume: number): void;
  /** Seconds. -1 when nothing is loaded. */
  getPosition(): Promise<number>;
  /** Seconds, or -1 when the duration is not yet known (streams report late). */
  getDuration(): Promise<number>;
  setNowPlaying(title: string, artist: string, artworkUrl: string, durationSeconds: number): void;
  /** True while the player is actually producing audio. */
  isPlaying(): Promise<boolean>;
}

// Resolved lazily, on first use, and NOT at module scope.
//
// At module scope this is evaluated while the bundle is still loading. If the
// TurboModule registry is not ready at that instant, get() returns null — and
// that null is captured into the export forever, even though the native module
// registers perfectly well moments later. The native side is asked for the
// module, builds it, and JS never sees it.
//
// getEnforcing has the same timing problem but at least fails loudly; it throws
// at module scope, which takes down the whole bundle before a screen renders.
// Neither is what we want, so: resolve on demand and cache once found.
let cached: Spec | null = null;

export function getNightAudio(): Spec | null {
  if (cached) return cached;
  cached = TurboModuleRegistry.get<Spec>("NightAudio");
  return cached;
}
