module.exports = {
  preset: '@react-native/jest-preset',

  // vendor/player is the shared player repo, consumed as a git submodule. Its
  // suites are vitest and are run by the site repo's runner; jest discovering
  // them here failed 19 suites on "Cannot find module 'vitest'" and made
  // `npm test` unreadable on a fresh clone. The player's logic is still
  // tested — over there, by the runner it was written for.
  testPathIgnorePatterns: ['/node_modules/', '/vendor/'],

  // react-native-mmkv (and its nitro peer) ship ESM. The preset's default list
  // transforms only react-native and @react-native packages, so importing MMKV
  // died on `export { createMMKV }` before any test could run.
  // react-native-safe-area-context is here for a different reason than the
  // rest: its jest mock ships as .tsx, inside node_modules, so it needs the
  // transform even though the package itself would not.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|react-native-mmkv|react-native-nitro-modules|react-native-safe-area-context|@react-native(-community)?)/)',
  ],

  // Deliberately setupFilesAfterEnv, not setupFiles: the preset owns
  // setupFiles, and setting that key here would replace React Native's own
  // setup instead of adding to it.
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
