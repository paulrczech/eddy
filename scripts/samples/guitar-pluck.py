#!/usr/bin/env python3
"""Process a rendered plucked-guitar sample set (Logic bounces) for Eddy.

    python3 scripts/samples/guitar-pluck.py <src-folder> <out-folder-name> [--ref <existing-samples-folder>] [--trim S]

Reads <src-folder>/<Root>.wav (E2, As2 = A#2, Cs3 ...), writes public/samples/<out>/<Root>.mp3.
Per file: starts the file at the pluck (leading silence trimmed to ~5 ms before the onset), keeps
--trim seconds (default 6.0 — the renders are cut there) with a 0.4 s fade-out, levels the first
second's PERCEIVED loudness (A-weighted RMS) to the REFERENCE guitar's at the same pitch
(default: public/samples/guitar-acoustic; its contour is lightly smoothed, then interpolated
between its roots), peak-limits to -1 dBFS, encodes 128 kbps with joint stereo off.

Why A-weighted: matching plain RMS left the lowest notes 6-9 dB too soft. A deep note's energy
sits in its fundamental, which the ear (and a phone speaker) barely registers, so it can
measure as loud as a brighter note and still sound much quieter.

Unlike the synth pads (scripts/samples/synth-pad.py) a pluck has no steady state, so it is
leveled on its first second, not on 2-6 s. Needs ffmpeg + numpy. Pitch/octave must be checked
before this (harmonic spectrum on the first ~0.6 s — a pluck is gone by the pad windows).
"""
import argparse, os, re, subprocess
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--ref', default=None)
ap.add_argument('--trim', type=float, default=6.0)
a = ap.parse_args()
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
REF = a.ref or os.path.join(REPO, 'public', 'samples', 'guitar-acoustic')
OUT = os.path.join(REPO, 'public', 'samples', a.out)
FR = 44100
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def midi(n):
    m = re.match(r'([A-G])(s?)(\d)$', n)
    return (int(m.group(3)) + 1) * 12 + NAMES.index(m.group(1) + ('#' if m.group(2) else ''))


def dec(path):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(FR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def a_weight(f):
    f = np.maximum(f, 1e-3); f2 = f ** 2
    return (12194 ** 2 * f2 ** 2) / ((f2 + 20.6 ** 2) * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2)) / 1.2589


def rms1(x):
    """A-weighted RMS (dB) of the first second of the mono mix — perceived loudness of a pluck."""
    m = x.mean(axis=1)[:FR]
    wt = np.fft.irfft(np.fft.rfft(m) * a_weight(np.fft.rfftfreq(len(m), 1 / FR)), len(m))
    return 20 * np.log10(max(np.sqrt((wt ** 2).mean()), 1e-9))


# the reference guitar's first-second RMS per root pitch, interpolated across pitch
ref_pts = sorted((midi(f[:-4]), rms1(dec(os.path.join(REF, f)))) for f in os.listdir(REF) if f.endswith(('.mp3', '.wav')))
ref_midi = [p for p, _ in ref_pts]; ref_db = [d for _, d in ref_pts]
# a reference guitar's own levels wander by a few dB from root to root — don't copy that, smooth it
ref_db = [float(np.mean(ref_db[max(0, i - 1):i + 2])) for i in range(len(ref_db))]

os.makedirs(OUT, exist_ok=True)
total = 0
for f in sorted(os.listdir(a.src), key=lambda n: midi(n[:-4]) if n.endswith('.wav') else 0):
    if not f.endswith('.wav'):
        continue
    pitch = midi(f[:-4])
    x = dec(os.path.join(a.src, f))
    env = np.abs(x).max(axis=1)
    onset = int(np.argmax(env > env.max() * 10 ** (-55 / 20)))
    x = x[max(0, onset - int(0.005 * FR)):][:int(a.trim * FR)]
    fade = int(0.4 * FR)
    x[-fade:] *= np.linspace(1, 0, fade)[:, None]
    target = float(np.interp(pitch, ref_midi, ref_db))
    x *= 10 ** ((target - rms1(x)) / 20)
    peak = np.abs(x).max()
    clipped = peak > 10 ** (-1 / 20)
    if clipped:
        x *= 10 ** (-1 / 20) / peak
    tmp = os.path.join(OUT, '_t.f32'); x.astype(np.float32).tofile(tmp)
    out = os.path.join(OUT, f[:-4] + '.mp3')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(FR), '-ac', '2', '-i', tmp,
                    '-codec:a', 'libmp3lame', '-b:a', '128k', '-joint_stereo', '0', out], check=True)
    os.remove(tmp); total += os.path.getsize(out)
    print(f'{f[:-4]:4} onset {onset / FR * 1000:5.1f}ms  target {target:6.1f}dB  peak {20 * np.log10(min(peak, 1e9)):6.1f}dB{"  (limited)" if clipped else ""}  {os.path.getsize(out) // 1024} KB')
print(f'total {total / 1024 / 1024:.2f} MB')
