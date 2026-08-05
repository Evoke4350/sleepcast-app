// MMKV is a native module: createMMKV() reaches through nitro to C++ that does
// not exist in a jest process. src/platform/storage.ts calls it at import time,
// on purpose — it installs the localStorage polyfill as a side effect before
// any shared player code runs — so merely importing App.tsx crashed the suite.
//
// react-native-mmkv ships its own in-memory mock, so use that rather than
// hand-rolling a Map: it tracks the real API, including the methods
// storage.ts depends on (getString, set, remove, getAllKeys, clearAll).
// Reach straight for the mock's own module. Requiring the package entry — even
// via requireActual, to spread its other exports — pulls in nitro's
// TurboModuleRegistry.getEnforcing, which is the exact native call being
// avoided here. storage.ts imports createMMKV and nothing else.
jest.mock('react-native-mmkv', () => {
  const {
    createMockMMKV,
  } = jest.requireActual('react-native-mmkv/lib/createMMKV/createMockMMKV');
  return {createMMKV: () => createMockMMKV()};
});

// SafeAreaProvider reads its insets from a native module. Without one it
// renders null children rather than failing loudly, so every testID in the
// tree simply stops existing and the failure reads as "component missing"
// instead of "no safe-area provider". The library ships a mock for exactly
// this; the .tsx extension is explicit because jest's default resolver
// doesn't try it for a bare subpath.
jest.mock(
  'react-native-safe-area-context',
  // .default because the mock is an ES default export and this require is
  // interop'd, not a namespace import.
  () => require('react-native-safe-area-context/jest/mock.tsx').default,
);

// react-native-youtube-iframe wraps react-native-webview, whose entry file
// ships ESM (`import WebView from './lib/WebView'`) that the preset's
// transform doesn't touch (see transformIgnorePatterns in jest.config.js) —
// requiring it verbatim throws "Cannot use import statement outside a
// module" before a single test runs. A real WebView also has nothing to
// render in a jest process: no native view manager, no network, no YouTube
// iframe. So the whole package is swapped for a stub here (same move as the
// MMKV/SafeAreaProvider mocks above) rather than fighting the transform.
// PLAYER_STATES/PLAYER_ERRORS are copied by value from the library's
// index.d.ts — src/youtube/YouTubePlayer.tsx indexes STATE_CODES/ERROR_CODES
// record objects with them at module scope, so the mock's strings have to
// match the real library's exactly or that indexing silently produces
// `undefined` codes.
jest.mock('react-native-youtube-iframe', () => {
  const React = require('react');
  const PLAYER_STATES = {
    ENDED: 'ended',
    PAUSED: 'paused',
    PLAYING: 'playing',
    UNSTARTED: 'unstarted',
    BUFFERING: 'buffering',
    VIDEO_CUED: 'video cued',
  };
  const PLAYER_ERRORS = {
    HTML5_ERROR: 'HTML5_error',
    VIDEO_NOT_FOUND: 'video_not_found',
    EMBED_NOT_ALLOWED: 'embed_not_allowed',
    INVALID_PARAMETER: 'invalid_parameter',
  };
  // Never actually driven in tests — YouTubeNightScreen's tests inject a fake
  // createPlayer that bypasses this component's ref entirely (see its own
  // report/comments) — so this only has to exist, not behave.
  const YoutubeIframe = React.forwardRef(function MockYoutubeIframe(_props, ref) {
    React.useImperativeHandle(ref, () => ({
      getCurrentTime: async () => 0,
      getDuration: async () => 0,
      getVideoUrl: async () => '',
      isMuted: async () => false,
      getVolume: async () => 0,
      getPlaybackRate: async () => 1,
      getAvailablePlaybackRates: async () => [1],
      seekTo: () => {},
    }));
    return null;
  });
  return { __esModule: true, default: YoutubeIframe, PLAYER_STATES, PLAYER_ERRORS };
});

// Install localStorage polyfill after mocks are set up, so that shared player
// code can use it synchronously without async setup.
// Jest's React Native preset provides an empty localStorage, so delete it first.
const { installLocalStorage } = require('./src/platform/storage');
delete global.localStorage;
installLocalStorage();

// Clear localStorage before each test to isolate test state and cache.
beforeEach(() => {
  if (global.localStorage) {
    global.localStorage.clear();
  }
});

