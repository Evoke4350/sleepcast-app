#!/usr/bin/env bash
#
# Build a fully onnxruntime-free foss release APK locally — the same result
# F-Droid produces (see docs/fdroid/com.sleepcastapp.foss.yml).
#
# The foss flavor never uses onnxruntime (the varied mix runs a pure-JS
# embedder), but a normal build still links it and downloads its prebuilt aar.
# RN autolinking excludes any package absent from node_modules, so this script
# temporarily moves onnxruntime-react-native aside, clears the stale autolinking
# cache, builds, then restores it (so `full` builds keep working).
#
# Requires JAVA_HOME + ANDROID_HOME in the environment (see the README / memory).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/node_modules/onnxruntime-react-native"
STASH="$(mktemp -d)/onnxruntime-react-native"

restore() { [ -d "$STASH" ] && mv "$STASH" "$MOD" && echo "restored onnxruntime-react-native"; }
trap restore EXIT

if [ -d "$MOD" ]; then
  mv "$MOD" "$STASH"
  echo "moved onnxruntime-react-native aside"
fi
rm -rf "$ROOT/android/app/build/generated/autolinking"

cd "$ROOT/android"
./gradlew assembleFossRelease -x lint "$@"

APK="$ROOT/android/app/build/outputs/apk/foss/release/app-foss-release.apk"
echo
echo "APK: $APK"
echo "onnxruntime .so in APK: $(unzip -l "$APK" | grep -ic onnxruntime)  (expect 0)"
echo "MiniLM model in APK:    $(unzip -l "$APK" | awk '$1>1000000 && /\.onnx/' | wc -l | tr -d ' ')  (expect 0)"
