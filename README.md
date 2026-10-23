# Misty Mahjong

A calm Mahjong solitaire game for Android phones and tablets, with five original tile sets inspired by fine materials, original music, and a choice of Asian ink-wash backgrounds.

Status: prototype.

![Game board on a phone](docs/screenshot.jpg)

## Features

Misty Mahjong is a classic 144-tile Mahjong solitaire game in the turtle layout. It runs entirely offline in a full-screen WebView.

- Tap two free, matching tiles to remove them. Flowers match other flowers, and seasons match other seasons. Every deal is solvable; if no pairs remain available, the remaining tiles are reshuffled.
- The ten-minute timer starts with the first pair. Scoring depends on the tile suit and the number of tiles remaining, with multipliers for consecutive matches in the same suit and a time bonus for clearing the board. Your best score is saved. Hints, pause, and a short how-to-play guide are included.
- Choose from five tile sets in Settings, even during a game. Your choice is saved:
  - **Mother-of-pearl:** a pearl slab on dark lacquer, with an inlaid moon on the back.
  - **Jade:** pale, veined stone with engraved, pigment-filled symbols and carved interlocking rings on the back.
  - **Sea glass:** frosted, translucent glass with embedded symbols and sandblasted waves on the back.
  - **Porcelain:** white glaze with cobalt rings and enamel colors, with a blue medallion on the back.
  - **Black lacquer:** urushi with gold frames and gold flecks over red lacquer sides, with a moon above waves on the back.
  Each set uses the same 42 traditional faces and their recognizable red, green, and blue colors; only the material changes.
- Matched pairs lift off, flip over, and collect in a growing stack beside the board while you continue playing. When the board is cleared, the whole stack takes a bow.
- The logo, music, and sound effects are original. Everything in the app is original work or used under a free license; see [THIRD-PARTY.md](THIRD-PARTY.md). Tiles are drawn at startup from gradients, noise, and paths rather than loaded from image files.
- Two seamless music loops are available in Settings: “Mondlicht auf dem Teich” (“Moonlight on the Pond”; koto, harp, erhu, and strings; the default) and “Koto und Erhu” (“Koto and Erhu”). Your choice is saved, and switching tracks crossfades between them.
- Choose from several ink-and-watercolor backgrounds. Settings also include music and effects volume, vibration, and free-tile highlighting. Your preferences are saved.
- No internet connection, ads, or tracking. The app does not request internet permission.
- The game and music pause when the app is in the background. The Back gesture does not end a game in progress.

## Languages

The interface supports 18 locales: English (`en`), German (`de`), French (`fr`), Spanish (`es`), Italian (`it`), Portuguese (`pt`), Dutch (`nl`), Polish (`pl`), Turkish (`tr`), Russian (`ru`), Ukrainian (`uk`), Arabic (`ar`), Hindi (`hi`), Indonesian (`id`), Japanese (`ja`), Korean (`ko`), Simplified Chinese (`zh-Hans`), and Traditional Chinese (`zh-Hant`).

The game automatically selects a supported language from your device's language preferences, falling back to English when no supported language matches. You can choose a different language in Settings; that override is saved for future launches. All translations are bundled with the app and work offline. Scripts not covered by the bundled fonts use system-font fallbacks.

## Build

Requirements: JDK 17 or later, Node 20 or later (for tests only), `zip`, and the Android SDK with Build-Tools 34.0.0 and Platform 34. On Debian/Ubuntu, install the Android packages with:

```sh
sudo apt install google-android-build-tools-34.0.0-installer google-android-platform-34-installer
```

Set `ANDROID_HOME` if your SDK is installed elsewhere.

```sh
npm test
scripts/build-apk
```

The resulting APK is `build/misty-mahjong.apk`. It is signed with the Android debug key at `~/.android/debug.keystore`, which is created if it does not exist. To update an installed version without uninstalling it, sign the update with the same key.

Ready-to-use music, sound effects, and backgrounds are included in the repository. To regenerate them, use `tools/make_audio.py` (requires numpy, scipy, and ffmpeg) and `tools/paint_backgrounds.py` (requires numpy and Pillow).

## Install

Copy the APK to your device and open it, allowing installation from unknown sources when prompted. Alternatively, install it over USB:

```sh
adb install -r build/misty-mahjong.apk
```

## Compatibility

Requires Android 7.0 (API 24) or later with an up-to-date Android System WebView. Designed for landscape orientation.

Previously checked on 2026-10-19 on a OnePlus CPH2653 running Android 16, with all five tile sets running smoothly at 120 Hz. Checks also covered a simulated tablet resolution of 2560×1600 at 320 dpi and Chromium with emulated tablet sizes of 2560×1600 and 2048×1536. These are the existing compatibility checks, not new device verification of the translations.

## License

The game, graphics, music, and sound effects are original work by the owner. The bundled fonts are licensed under the SIL Open Font License. See [THIRD-PARTY.md](THIRD-PARTY.md) for third-party components and their licenses.
