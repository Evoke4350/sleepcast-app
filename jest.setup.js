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
