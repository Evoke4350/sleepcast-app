module.exports = {
  root: true,
  extends: '@react-native',

  // vendor/player is the shared player repo, consumed as a git submodule and
  // canonical there — a fix applied here is on no branch of this repo and
  // vanishes at the next submodule bump. It carries its own lint setup, and
  // linting it from here produced 9 errors nobody in this repo may act on,
  // against 0 in the app's own code.
  ignorePatterns: ['vendor/', 'node_modules/', 'android/', 'ios/'],
};
