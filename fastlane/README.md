# F-Droid / fastlane metadata

F-Droid reads app store listing text and images from this tree (the
[fastlane structure](https://f-droid.org/docs/All_About_Descriptions_Graphics_and_Screenshots/)).

```
fastlane/metadata/android/en-US/
  title.txt                    app name in the listing
  short_description.txt        one line, ≤ 80 chars
  full_description.txt         the listing body (limited markdown)
  changelogs/1.txt             notes for versionCode 1 (add 2.txt, 3.txt, …)
  images/
    phoneScreenshots/*.png     real device captures (foss build, Pixel)
    icon.png                   OPTIONAL — see below
    featureGraphic.png         OPTIONAL 1024×500 banner
```

## Icon

The launcher icon is a VectorDrawable (see `assets/logo.svg` for the master and
`android/app/src/main/res/drawable/ic_launcher_foreground.xml`). F-Droid falls
back to the icon in the APK when `images/icon.png` is absent, so a PNG here is
optional. To add one, rasterize `assets/logo.svg` to a 512×512 PNG, e.g.:

```
rsvg-convert -w 512 -h 512 assets/logo.svg > fastlane/metadata/android/en-US/images/icon.png
# or: inkscape assets/logo.svg -w 512 -h 512 -o .../icon.png
```

(Left out of the repo because this build host had no SVG rasterizer.)

## Build recipe

The fdroiddata build recipe (server side, not in this repo) starts from
`docs/fdroid/com.sleepcastapp.foss.yml`. Tag the release commit `v1.0-foss`
and bump `versionCode`/`changelogs` per release.
