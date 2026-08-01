# sleepcast-app

React Native, bare (no Expo). iOS and Android.

The player logic is **not in this repo** — `vendor/player` is a submodule of
[sleepcast-player](https://github.com/Evoke4350/sleepcast-player), which stays
canonical for the sleep detector, shuffle, position memory and the fade curve.
Fix logic bugs there and bump the pointer; editing `vendor/` directly leaves a
change on no branch of anything.

```bash
git submodule update --init
mise exec node@22 -- npm install
```

## Android — builds on Linux

**Pin JDK 21.** The system default here is JDK 26 and Gradle rejects it. This
is the first thing that will waste an afternoon:

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk
export ANDROID_HOME=$HOME/Android
export ANDROID_SDK_ROOT=$HOME/Android
```

```bash
# emulator (headless; an AVD named noctos-test already exists)
$ANDROID_HOME/emulator/emulator -avd noctos-test -no-window -no-audio &
$ANDROID_HOME/platform-tools/adb wait-for-device

cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Debug builds need the JS bundle served. Without Metro you get a red screen.
npx react-native start
adb reverse tcp:8081 tcp:8081
```

Verified: RN 0.86.2 on Hermes, `assembleDebug` → install → renders on the
emulator.

## iOS — needs a Mac

Nothing in the iOS path can be built or tested on Linux, so it is written
blind here and debugged there.

```bash
cd ios && pod install
open SleepcastApp.xcworkspace
```

Set the signing team, then add to `Info.plist`:

```xml
<key>UIBackgroundModes</key>
<array><string>audio</string></array>
```

Without that key iOS suspends the app on lock and the audio stops — which is
the entire product.

## Dependencies worth knowing about

- **react-native-mmkv** — synchronous storage, chosen precisely for that: the
  shared player code calls `localStorage.getItem` inline in ~40 places, so MMKV
  can be polyfilled under it and that code runs unmodified. AsyncStorage is
  promise-based and would have forced a refactor of a repo the website also
  depends on.
- **react-native-nitro-modules** — a peer dependency of MMKV 4. It is not
  installed automatically, and the Gradle failure it causes names a missing
  *Gradle project* rather than a missing package, which is not obvious.
- **fast-xml-parser** — feed parsing. The shared `parseFeedXml` uses
  `DOMParser`/`querySelector`, which no RN XML library implements faithfully,
  so the native side parses to the same `Episode[]` instead.

## Audio

A thin custom native module rather than a dependency — see
`docs/specs/2026-07-31-ios-thin-slice-design.md` for why
`react-native-track-player` was rejected.

The fade stays in TypeScript, using `fadeVolume` from the shared repo, driving
`setVolume`. The native module is deliberately dumb: play, pause, volume,
position, Now Playing. Keeping the fade curve in tested shared code is the
point, and it means the same curve runs on both platforms.
