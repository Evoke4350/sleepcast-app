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
    icon.png                   512×512 listing icon (see below)
    featureGraphic.png         1024×500 banner (see below)
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

## Feature graphic

`images/featureGraphic.png` is the 1024×500 store banner (moon+stars logo +
"sleepcast" wordmark + tagline on the night sky), from master
`assets/feature-graphic.svg`. That SVG is authored as a 1024-square with the
banner centred vertically, so a centre-crop yields an exact 1024×500:

```
# macOS: render the square, then centre-crop to 1024×500
qlmanage -t -s 1024 -o /tmp assets/feature-graphic.svg
sips -c 500 1024 /tmp/feature-graphic.svg.png --out fastlane/metadata/android/en-US/images/featureGraphic.png
```

## Build recipe & submission (current, 2026)

The fdroiddata build recipe (server side, not in this repo) starts from
`docs/fdroid/com.sleepcastapp.foss.yml`. Fastlane assets (this tree) are read by
F-Droid from the app repo at the tagged commit, so they must be committed on the
release tag.

Submit via a **merge request to `gitlab.com/fdroid/fdroiddata`** (RFP is only for
"please package this" requests):

1. Tag the release: `git tag v1.0-foss && git push origin v1.0-foss` (bump
   `versionCode` + add `changelogs/<code>.txt` per release).
2. Fork fdroiddata; add the recipe as `metadata/com.sleepcastapp.foss.yml` on a
   branch named `com.sleepcastapp.foss` (not `master`).
3. Finalize locally with `fdroidserver` (+ Docker): `fdroid lint`,
   `fdroid rewritemeta`, then `fdroid build -l com.sleepcastapp.foss` — iterate
   the `scanignore` list until the build passes, and confirm the `output:` APK
   name (make the release **unsigned** — drop the debug signingConfig — since
   F-Droid signs with its own key).
4. Push to your fork, make its **CI pipeline pass**, then open the MR (commit
   subject `New App: com.sleepcastapp.foss`, fill the MR template).

Recipe notes reflect the current RN pattern: Node comes from a pinned tarball +
sha256 in `sudo:` (the buildserver's apt Node is too old for RN 0.86), and
node_modules prebuilts are handled with `rm`/`scandelete` + a `scanignore`
whitelist. See the live reference recipe `metadata/com.mattermost.rnbeta.yml` in
fdroiddata.
