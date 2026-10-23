#!/usr/bin/env python3
"""Makes the music loop and the sound effects of Misty Mahjong.

The effects are built from real instrument samples (CC0, in tools/samples/):
soft-mallet marimba and vibraphone, low hand chimes, frame drum, slit drum and
gong, every pitched note retuned exactly into D-flat major pentatonic so the
effects sit in tune with the music, then low-passed and given a synthetic
convolution reverb; everything is encoded with ffmpeg to Ogg Opus:

    python3 tools/make_audio.py            # writes web/assets/audio/*.ogg

The music comes in two selectable tracks from tools/music/, listed in
music.json with their exact loop lengths for the player:

- "Mondlicht auf dem Teich" (the default), a koto, harp, erhu and strings
  piece composed for the game, delivered as an exact 28-bar loop at 90 bpm;
  it is resampled to SR circularly, so the seam stays seamless.
- The owner's koto and erhu recording, 17 bars at 100 bpm: the loop ends
  after the last bar and the fade-out behind it is folded onto the beginning.
"""

import json
import math
import os
import subprocess
import sys
import tempfile
from fractions import Fraction

import numpy as np
from scipy import signal

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "assets", "audio")

rng = np.random.default_rng(20261019)


def lowpass(x, hz, order=2):
    b, a = signal.butter(order, hz / (SR / 2))
    return signal.lfilter(b, a, x)


def highpass(x, hz, order=2):
    b, a = signal.butter(order, hz / (SR / 2), btype="high")
    return signal.lfilter(b, a, x)


# ---------------------------------------------------------------- instruments

# Mono cuts of CC0 samples from the Versilian Community Sample Library (see
# tools/samples/vcsl/SOURCES.md). PITCH holds the measured pitch of each pitched
# sample as a MIDI number with its cents, so every note is retuned exactly.
SAMPLES = os.path.join(ROOT, "tools", "samples", "vcsl")
PITCH = {
    "marimba_C3": 48.023, "marimba_G3": 55.003, "marimba_B3": 59.028, "marimba_F4": 64.999, "marimba_C5": 72.046,
    "marimba_G5": 78.977, "marimba_B5": 83.001,
    "vibes_C4": 59.999, "vibes_E4": 64.0, "vibes_G4": 66.998, "vibes_B4": 70.998, "vibes_D5": 74.0,
    "chime_E4": 64.063, "chime_Gs4": 68.019,
    "framedrum": 39.891,      # its fundamental, E2
    "slit_hi": 51.0, "slit_hi_soft": 51.04,
    "gong_p": 49.61,          # two partials an octave apart, 143.6 and 287.2 Hz
}
_samples = {}


def sample(name):
    """Decodes a sample once to mono float at SR."""
    if name not in _samples:
        raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", os.path.join(SAMPLES, name + ".flac"),
                              "-ar", str(SR), "-ac", "1", "-f", "f32le", "-"], capture_output=True, check=True).stdout
        _samples[name] = np.frombuffer(raw, dtype="<f4").astype(np.float64)
    return _samples[name]


def note(name, midi=None, vel=1.0, dur=None):
    """The sample retuned to the MIDI note `midi` (as recorded without one),
    scaled by vel and, with dur, cut to that many seconds with a soft fade."""
    x = sample(name)
    if midi is not None:
        stretch = Fraction(2 ** ((PITCH[name] - midi) / 12)).limit_denominator(1000)
        x = signal.resample_poly(x, stretch.numerator, stretch.denominator)
    if dur is not None and len(x) > dur * SR:
        x = x[: int(dur * SR)].copy()
        fade = int(min(0.3, dur * 0.4) * SR)
        x[-fade:] *= np.linspace(1, 0, fade) ** 2
    return x * vel


def play(family, midi, vel=1.0, dur=None):
    """A note on an instrument family (marimba, vibes, chime), taken from the
    sample nearest in pitch."""
    names = [k for k in PITCH if k.rsplit("_", 1)[0] == family]
    return note(min(names, key=lambda k: abs(PITCH[k] - midi)), midi, vel, dur)


# -------------------------------------------------------------------- reverb

def make_ir(seconds=2.6, predelay=0.012, darkness=1700):
    """Stereo impulse response: decorrelated noise with an exponential decay
    that gets darker over time, plus a few early reflections."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    for ch in range(2):
        noise = rng.standard_normal(n)
        decay = np.exp(-t / (seconds * 0.32))
        # Darkening: mix of a lowpassed version increasing with time
        lp = lowpass(noise, darkness, 1)
        mix = np.clip(t / seconds * 1.6, 0, 1)
        tail = (noise * (1 - mix) + lp * mix) * decay
        ir[:, ch] = tail
    early = np.zeros((n, 2))
    for dt, g, side in [(0.019, 0.5, 0), (0.027, 0.4, 1), (0.041, 0.3, 0), (0.053, 0.25, 1), (0.071, 0.2, 0)]:
        i = int(dt * SR)
        early[i, side] += g
        early[i + 7, 1 - side] += g * 0.6
    ir = ir * 0.08 + early
    pre = np.zeros((int(predelay * SR), 2))
    ir = np.vstack([pre, ir])
    ir /= np.max(np.abs(ir.sum(axis=1))) * 2.2
    return ir


IR = make_ir()
IR_SHORT = make_ir(1.1, 0.006, 2600)


def reverb(stereo, wet=0.3, ir=None):
    ir = IR if ir is None else ir
    n = len(stereo) + len(ir) - 1
    out = np.zeros((n, 2))
    for ch in range(2):
        out[:, ch] = signal.fftconvolve(stereo[:, ch], ir[:, ch])[:n]
    dry = np.vstack([stereo, np.zeros((len(ir) - 1, 2))])
    return dry + out * wet


# ---------------------------------------------------------------- composing

class Track:
    def __init__(self, seconds):
        self.buf = np.zeros((int(seconds * SR) + SR * 8, 2))

    def add(self, mono, at, pan=0.0, gain=1.0):
        i = max(0, int(at * SR))
        n = len(mono)
        if i + n > len(self.buf):
            n = len(self.buf) - i
        l = math.cos((pan + 1) * math.pi / 4)
        r = math.sin((pan + 1) * math.pi / 4)
        self.buf[i:i + n, 0] += mono[:n] * l * gain
        self.buf[i:i + n, 1] += mono[:n] * r * gain


# Db major pentatonic, the key of the music, written as MIDI numbers.
F2 = 41
Db3, Eb3, F3, Ab3, Bb3 = 49, 51, 53, 56, 58
Db4, Eb4, F4, Ab4, Bb4 = 61, 63, 65, 68, 70
Db5, Eb5, F5, Ab5, Bb5 = 73, 75, 77, 80, 82
Db6 = 85


# ------------------------------------------------------------------- music

MUSIC_DIR = os.path.join(ROOT, "tools", "music")


def load_music(name, rate=SR):
    """Decodes a recording in tools/music/ to float stereo at the given rate."""
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", os.path.join(MUSIC_DIR, name),
                          "-ar", str(rate), "-ac", "2", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)


def resample_loop(x, rate):
    """Resamples a loop that is exactly one period long to SR as a circular
    signal, so the filter sees the end before the start and the seam stays clean."""
    ratio = Fraction(SR, rate)
    pad = rate // 10
    wrapped = np.concatenate([x[-pad:], x, x[:pad]])
    y = signal.resample_poly(wrapped, ratio.numerator, ratio.denominator, axis=0)
    start = pad * ratio.numerator // ratio.denominator
    return y[start: start + len(x) * ratio.numerator // ratio.denominator]


def mondlicht():
    # Composed for the game as an exact loop: 28 bars at 90 bpm, its reverb
    # and last notes already laid onto the start.
    return resample_loop(load_music("mondlicht_auf_dem_teich.flac", 44100), 44100)


def koto_erhu():
    # The owner's koto and erhu recording: 17 bars at 100 bpm, then a fade.
    return fold_loop(load_music("B_koto_erhu.mp3"), 17 * 4 * 60 / 100)


# The selectable tracks, the first is the default: id, German name, loop maker.
TRACKS = [
    ("mondlicht", "Mondlicht auf dem Teich", mondlicht),
    ("koto-erhu", "Koto und Erhu", koto_erhu),
]


def fold_loop(mix, loop_seconds):
    """Cuts the mix to the loop length and adds everything beyond it (the
    tails) onto the beginning, so the loop joins seamlessly."""
    n = int(round(loop_seconds * SR))
    out = mix[:n].copy()
    tail = mix[n:]
    k = min(len(tail), n)
    out[:k] += tail[:k]
    return out


def trim_tail(x, floor_db=-54, pad=0.06):
    """Cuts the silence after the last audible sample."""
    env = np.max(np.abs(x), axis=1)
    thr = np.max(env) * 10 ** (floor_db / 20)
    last = np.max(np.nonzero(env > thr)[0])
    n = min(len(x), last + int(pad * SR))
    y = x[:n].copy()
    fade = int(0.03 * SR)
    y[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return y


def master(x, target_peak=0.95, tilt_hz=9000):
    y = x.copy()
    for ch in range(y.shape[1]):
        y[:, ch] = highpass(y[:, ch], 38, 2)
        y[:, ch] = lowpass(y[:, ch], tilt_hz, 2)
    # Soft-knee saturation keeps peaks gentle.
    y = np.tanh(y * 1.1) / math.tanh(1.1)
    peak = np.max(np.abs(y)) + 1e-9
    return y / peak * target_peak


def write_wav(path, x):
    from scipy.io import wavfile
    wavfile.write(path, SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))


def measure_lufs(path):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    lines = [l for l in out.splitlines() if "I:" in l and "LUFS" in l]
    return float(lines[-1].split("I:")[1].split("LUFS")[0]) if lines else None


def encode(wav, ogg, kbps):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", "libopus",
                    "-b:a", f"{kbps}k", "-vbr", "on", "-application", "audio", ogg], check=True)


def normalize_to(x, lufs_target, tmpdir, name):
    tmp = os.path.join(tmpdir, name + ".wav")
    write_wav(tmp, x)
    measured = measure_lufs(tmp)
    if measured is None:
        return x, None
    gain = 10 ** ((lufs_target - measured) / 20)
    y = x * gain
    peak = np.max(np.abs(y))
    if peak > 0.98:
        y = np.tanh(y * 0.98 / peak * 1.0)
    return y, measured


# ------------------------------------------------------------------- effects

def stereo(mono):
    return np.column_stack([mono, mono])


# Warm, round tones: soft-mallet marimba and vibraphone, low hand chimes, a frame
# drum and a slit drum, between F2 and D-flat 6 and low-passed (EFFECTS_LOWPASS),
# so nothing is shrill. A match is short: two wooden knocks for the two tiles
# meeting, then a quick marimba figure that lands on D-flat and dies away, so it
# confirms the pair without lingering over the music.
EFFECTS_LOWPASS = 3500


def fx_select():
    tr = Track(1.0)
    tr.add(play("marimba", F4, 0.9, 0.6), 0.0)
    tr.add(play("marimba", Db4, 0.45, 0.6), 0.0)
    return reverb(tr.buf[: int(0.8 * SR)], 0.18, IR_SHORT)


def fx_tap():
    tr = Track(0.5)
    tr.add(play("marimba", Ab3, 0.6, 0.25), 0.0)
    tr.add(note("slit_hi_soft", Eb3, 0.25, 0.2), 0.0)
    return reverb(tr.buf[: int(0.4 * SR)], 0.1, IR_SHORT)


def pair_knock(tr):
    """Two wooden knocks a moment apart, the two tiles meeting."""
    tr.add(note("slit_hi", Eb3, 0.55, 0.22), 0.0, pan=-0.2)
    tr.add(note("slit_hi_soft", F3, 0.5, 0.22), 0.045, pan=0.2)


def fx_match():
    tr = Track(1.2)
    pair_knock(tr)
    tr.add(play("marimba", Ab4, 0.7, 0.3), 0.05, pan=-0.1)
    tr.add(play("marimba", Db5, 0.9, 0.45), 0.12, pan=0.1)
    tr.add(play("marimba", Db4, 0.4, 0.45), 0.12)
    return reverb(tr.buf[: int(0.8 * SR)], 0.14, IR_SHORT)


# A chain of matches plays the same figure rising further: each level adds a step
# and ends higher, from F5 up to D-flat 6.
CHAIN = {2: (Ab4, Db5, F5), 3: (Ab4, Db5, F5, Ab5), 4: (Ab4, Db5, F5, Ab5, Bb5), 5: (Db5, F5, Ab5, Bb5, Db6),
         6: (Ab4, Db5, F5, Ab5, Bb5, Db6)}


def fx_chain(level):
    def make():
        tr = Track(1.5)
        pair_knock(tr)
        notes = CHAIN[level]
        for i, m in enumerate(notes):
            last = i == len(notes) - 1
            tr.add(play("marimba", m, 0.9 if last else 0.7, 0.45 if last else 0.25), 0.05 + i * 0.055,
                   pan=-0.25 + 0.5 * i / (len(notes) - 1))
        tr.add(play("marimba", notes[-1] - 12, 0.4, 0.45), 0.05 + (len(notes) - 1) * 0.055)
        return reverb(tr.buf[: int(1.1 * SR)], 0.16, IR_SHORT)
    return make


def fx_blocked():
    tr = Track(1.0)
    tr.add(note("slit_hi", Eb3, 0.7, 0.4), 0.0)
    tr.add(play("marimba", Db3, 0.6, 0.5), 0.12)
    tr.add(note("framedrum", F2, 0.35, 0.5), 0.12)
    return reverb(tr.buf[: int(0.7 * SR)], 0.12, IR_SHORT)


def fx_hint():
    tr = Track(2.5)
    tr.add(play("vibes", F4, 0.7, 2.0), 0.0, pan=-0.2)
    tr.add(play("chime", Ab4, 0.6, 2.0), 0.18, pan=0.2)
    return reverb(tr.buf[: int(2.2 * SR)], 0.35)


def fx_shuffle():
    tr = Track(2.5)
    tr.add(note("framedrum", F2, 0.3, 0.8), 0.0)
    roll = [Db3, Ab3, F3, Db4, Ab3, F4, Db4, Ab4, F4, Db5]
    for i, m in enumerate(roll):
        v = 0.35 + 0.35 * math.sin(math.pi * (i + 0.5) / len(roll))
        tr.add(play("marimba", m, v, 0.5), i * 0.07, pan=0.35 if i % 2 else -0.35)
    tr.add(play("vibes", Db4, 0.5, 1.6), 0.72, pan=-0.1)
    tr.add(play("vibes", Ab4, 0.4, 1.6), 0.72, pan=0.1)
    return reverb(tr.buf[: int(2.4 * SR)], 0.3)


def fx_win():
    tr = Track(5.5)
    tr.add(note("gong_p", Db3, 0.45, 5.0), 0.0)
    tr.add(note("framedrum", F2, 0.4, 1.0), 0.0)
    for i, m in enumerate([Db3, F3, Ab3, Db4, F4, Ab4, Db5]):
        tr.add(play("marimba", m, 0.75, 1.6), 0.12 + i * 0.11, pan=-0.4 + i * 0.13)
    for i, m in enumerate([Db4, F4, Ab4, Db5]):
        tr.add(play("vibes", m, 0.45, 3.5), 0.9, pan=-0.2 + i * 0.13)
    tr.add(play("chime", F4, 0.4, 3.5), 1.0)
    return reverb(tr.buf[: int(5.0 * SR)], 0.38)


def fx_over():
    tr = Track(5.0)
    tr.add(note("gong_p", Db3, 0.5, 4.5), 0.0)
    for i, m in enumerate([Ab3, F3, Db3]):
        at, dur = 0.3 + i * 0.55, 3.2 if i == 2 else 2.4
        tr.add(play("marimba", m, 0.7, dur), at, pan=0.1 - i * 0.1)
        tr.add(play("vibes", m + 12, 0.3, dur), at, pan=0.1 - i * 0.1)
    return reverb(tr.buf[: int(4.6 * SR)], 0.4)


def fx_warning():
    tr = Track(1.4)
    for i, v in enumerate((0.9, 0.75)):
        tr.add(play("chime", Eb4, 0.6 * v, 1.0), i * 0.3, pan=-0.15 if i == 0 else 0.15)
        tr.add(play("marimba", Db3, 0.5 * v, 0.6), i * 0.3)
    return reverb(tr.buf[: int(1.4 * SR)], 0.2, IR_SHORT)


EFFECTS = {
    "select": (fx_select, -22),
    "tap": (fx_tap, -24),
    "match": (fx_match, -18),
    **{f"chain{n}": (fx_chain(n), -17) for n in CHAIN},
    "blocked": (fx_blocked, -21),
    "hint": (fx_hint, -20),
    "shuffle": (fx_shuffle, -20),
    "win": (fx_win, -16),
    "over": (fx_over, -17),
    "warning": (fx_warning, -21),
}


def main():
    os.makedirs(OUT, exist_ok=True)
    tmpdir = tempfile.mkdtemp(prefix="nebel-audio-")
    # The recordings are already mixed and mastered: only their loudness is set.
    tracks = []
    for track_id, name, make in TRACKS:
        loop, measured = normalize_to(make(), -19.0, tmpdir, track_id)
        loop = np.clip(loop, -1, 1)
        wav = os.path.join(tmpdir, track_id + ".wav")
        write_wav(wav, loop)
        file = f"music-{track_id}.ogg"
        encode(wav, os.path.join(OUT, file), 96)
        tracks.append({"id": track_id, "name": name, "file": "assets/audio/" + file,
                       "loopSeconds": len(loop) / SR, "samples": len(loop)})
        print(f"{track_id}: {len(loop) / SR:.3f} s, {len(loop)} samples, "
              f"pre-normalisation {measured} LUFS, now {measure_lufs(wav)} LUFS")
    with open(os.path.join(OUT, "music.json"), "w") as f:
        json.dump({"sampleRate": SR, "tracks": tracks}, f, ensure_ascii=False, indent=1)
    for name, (fn, lufs) in EFFECTS.items():
        x = trim_tail(fn())
        x = master(x, 0.9, EFFECTS_LOWPASS)
        x, _ = normalize_to(x, lufs, tmpdir, name)
        wav = os.path.join(tmpdir, name + ".wav")
        write_wav(wav, np.clip(x, -1, 1))
        encode(wav, os.path.join(OUT, name + ".ogg"), 64)
        print(f"{name}: {len(x) / SR:.2f} s, {measure_lufs(wav)} LUFS")
    for f in os.listdir(tmpdir):
        os.remove(os.path.join(tmpdir, f))
    os.rmdir(tmpdir)
    print("written to", OUT)


if __name__ == "__main__":
    sys.exit(main())
