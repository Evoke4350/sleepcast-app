//
// Inert FOSS stand-in for YouTubePlayer.tsx. The FOSS build drops YouTube, and
// the Metro resolver swaps this in so the real component's react-native-youtube-
// iframe / react-native-webview JS never enters the bundle. foss never routes to
// a YouTube night (SetupScreen rejects YouTube URLs, App gates the route), so
// this is never mounted — it exists only to satisfy the swap and type-check any
// stale references. Renders nothing.
import { forwardRef } from "react";
import type { YouTubePlayerHandle } from "./YouTubePlayer";

export type { YouTubePlayerHandle } from "./YouTubePlayer";

// Accept any props the real component takes; ignore them.
const YouTubePlayerFoss = forwardRef<YouTubePlayerHandle, Record<string, unknown>>(
  (_props, _ref) => null
);

export default YouTubePlayerFoss;
