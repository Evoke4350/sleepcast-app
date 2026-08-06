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

`images/icon.png` is the 512×512 listing icon (a full-bleed square: crescent
moon + stars on the night-dark tile), rasterized from the master `assets/logo.svg`.
The launcher icon itself is a VectorDrawable (`assets/logo.svg` master →
`android/app/src/main/res/drawable/ic_launcher_foreground.xml`).

To regenerate the PNG from the SVG:

```
# macOS (no extra tools): render a 512px square copy
sed 's/width="108" height="108"/width="512" height="512"/' assets/logo.svg > /tmp/logo512.svg
qlmanage -t -s 512 -o /tmp /tmp/logo512.svg && mv /tmp/logo512.svg.png fastlane/metadata/android/en-US/images/icon.png
# or with librsvg:  rsvg-convert -w 512 -h 512 assets/logo.svg > .../images/icon.png
```

## Build recipe

The fdroiddata build recipe (server side, not in this repo) starts from
`docs/fdroid/com.sleepcastapp.foss.yml`. Tag the release commit `v1.0-foss`
and bump `versionCode`/`changelogs` per release.
