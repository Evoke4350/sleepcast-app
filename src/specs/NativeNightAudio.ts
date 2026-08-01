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

export default TurboModuleRegistry.getEnforcing<Spec>("NightAudio");
