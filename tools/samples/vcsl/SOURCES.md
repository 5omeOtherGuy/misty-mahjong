# Instrument samples for the sound effects

Mono cuts of samples from the Versilian Community Sample Library (VCSL) by
Versilian Studios, https://github.com/sgossner/VCSL (commit
c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e), licensed CC0 1.0 (public domain
dedication). `tools/make_audio.py` builds the game's sound effects from them.

Each file is the source averaged to mono, cut from just before its onset to the
length given, faded out over its last quarter (at most 0.4 s) and peak-normalised
to -1 dBFS, stored as 16-bit FLAC at the source's 44.1 kHz. The pitch column is
the measured fundamental as a MIDI number (60 = C4, cents as decimals), for the
gong and the slit drum their strongest partial: the value `PITCH` in
`make_audio.py` retunes from. VCSL's file names are often an octave off, so the
names here give the sounding pitch.

| File | VCSL source | Seconds | Pitch |
|---|---|---|---|
| `chime_E4.flac` | `Idiophones/Struck Idiophones/Hand Chimes/sus_E3_r01_main.wav` | 4.00 | 64.063 |
| `chime_Gs4.flac` | `Idiophones/Struck Idiophones/Hand Chimes/sus_G#3_r01_main.wav` | 4.00 | 68.019 |
| `framedrum.flac` | `Membranophones/Struck Membranophones/Frame Drum/HDrumL_Hit_v3_rr1_Sum.wav` | 1.50 | 39.891 |
| `gong_p.flac` | `Idiophones/Struck Idiophones/Gong 1/gong_p.wav` | 8.00 | 49.610 |
| `marimba_B3.flac` | `Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_B2_soft_01.wav` | 3.00 | 59.028 |
| `marimba_B5.flac` | `Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_B4_soft_01.wav` | 1.80 | 83.001 |
| `marimba_C3.flac` | `Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_C2_soft_01.wav` | 3.00 | 48.023 |
| `marimba_C5.flac` | `Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_C4_soft_01.wav` | 2.50 | 72.046 |
| `marimba_F4.flac` | `Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_F3_soft_01.wav` | 3.00 | 64.999 |
| `marimba_G3.flac` | `Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_G2_soft_01.wav` | 3.00 | 55.003 |
| `marimba_G5.flac` | `Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_G4_soft_01.wav` | 2.00 | 78.977 |
| `slit_hi.flac` | `Idiophones/Struck Idiophones/Slit Drum/LogDrumHi_MedM_v2_rr1_Sum.wav` | 1.00 | 51.000 |
| `slit_hi_soft.flac` | `Idiophones/Struck Idiophones/Slit Drum/LogDrumHi_MedM_v1_rr1_Sum.wav` | 1.00 | 51.040 |
| `vibes_B4.flac` | `Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_B3_v1_rr1_Main.wav` | 4.00 | 70.998 |
| `vibes_C4.flac` | `Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_C3_v1_rr2_Main.wav` | 4.00 | 59.999 |
| `vibes_D5.flac` | `Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_D4_v1_rr1_Main.wav` | 4.00 | 74.000 |
| `vibes_E4.flac` | `Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_E3_v1_rr2_Main.wav` | 4.00 | 64.000 |
| `vibes_G4.flac` | `Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_G3_v1_rr1_Main.wav` | 4.00 | 66.998 |
