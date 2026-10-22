#!/usr/bin/env python3
"""Process one of Paul's rendered synth-pad sample sets (Logic bounces) for Eddy.

    python3 scripts/samples/synth-pad.py <src-folder> <out-folder-name> [--octave N] [--trim SECONDS]

Reads <src-folder>/<Root>.wav (names like E2, As2 = A#2, Cs3 ...), writes
public/samples/<out-folder-name>/<Root>.mp3. Per file: keeps the first --trim seconds (default
7.4; the sound usually ends ~7s) with a 0.25 s fade, levels it so its steady-state RMS (2-6 s)
matches the loudness reference table below (the removed choir pad's, so every pad sits at the
same level), peak-limits to -1 dBFS, and encodes 128 kbps
with joint stereo OFF (the pads are decorrelated L/R; joint coding damages them).

--low-assist DB1[,DB2] mixes the octave(s) above into roots below E3 (needs those source files).
--octave N renames each file to its TRUE pitch (+12*N semitones): Paul's first renders sounded an
octave above their names (measured: no energy at the named pitch), so use --octave 1 for those
and drop files that land above Eddy's E2-C6 range. Check first with a harmonic spectrum.
Needs ffmpeg + numpy. Measured checks used while developing this: pitch (harmonic product
spectrum + energy at f0 vs 2f0), tuning (energy-weighted harmonic centroids), tail (last time
above -60 dBFS), L/R correlation.
"""
import argparse, os, re, subprocess
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--octave', type=int, default=0)
ap.add_argument('--trim', type=float, default=7.4)
ap.add_argument('--low-assist', default=None, metavar='DB1[,DB2]',
                help='roots below E3 get the same note one octave up mixed in at DB1 and (optional) two octaves up at DB2, e.g. -6,-8: a dark patch has almost no overtones down there, and the octave-up file is itself dark')
a = ap.parse_args()
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(REPO, 'public', 'samples', a.out)
FR = 44100
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
REF_RMS_DB = {  # steady-state (2-6 s) RMS in dB of the removed choir pad, per MIDI note — the loudness reference every pad was matched to
    43: -23.1,
    44: -24.0,
    45: -24.5,
    46: -22.1,
    47: -24.6,
    48: -22.2,
    49: -23.5,
    50: -26.6,
    51: -25.2,
    52: -23.6,
    53: -23.4,
    54: -22.7,
    55: -25.5,
    56: -21.3,
    57: -24.3,
    58: -23.1,
    59: -20.5,
    60: -22.8,
    61: -22.0,
    62: -21.3,
    63: -21.6,
    64: -20.5,
    65: -22.9,
    66: -22.3,
    67: -22.9,
    68: -22.3,
    69: -21.8,
    70: -23.1,
    71: -22.2,
    72: -23.1,
    73: -23.3,
    74: -24.9,
    75: -23.8,
    76: -22.8,
    77: -23.1,
    78: -24.5,
    79: -23.2,
    80: -22.4,
    81: -22.2,
    82: -22.7,
    83: -23.9,
    84: -24.1,
}


def midi(n):
    m = re.match(r'([A-G])(s?)(\d)$', n)
    return (int(m.group(3)) + 1) * 12 + NAMES.index(m.group(1) + ('#' if m.group(2) else ''))


def fname(m): return NAMES[m % 12].replace('#', 's') + str(m // 12 - 1)


def dec(path):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(FR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def rms_db(x, s, e):
    seg = x[int(s * FR):int(e * FR)]
    return 20 * np.log10(max(np.sqrt((seg ** 2).mean()), 1e-9))


os.makedirs(OUT, exist_ok=True)
total = 0
for f in sorted(os.listdir(a.src), key=lambda n: midi(n[:-4]) if n.endswith('.wav') else 0):
    if not f.endswith('.wav'):
        continue
    true = midi(f[:-4]) + 12 * a.octave
    if not 40 <= true <= 84:
        print(f'{f}: true pitch {fname(true)} is outside Eddy\'s E2-C6 range — skipped')
        continue
    x = dec(os.path.join(a.src, f))[:int(a.trim * FR)]
    if a.low_assist is not None and true < 52:
        # octave doublings for the lowest roots (a string section doubles its basses the same way)
        for octs, db in enumerate(float(v) for v in a.low_assist.split(',')):
            up = os.path.join(a.src, fname(midi(f[:-4]) + 12 * (octs + 1)) + '.wav')
            x = x + 10 ** (db / 20) * dec(up)[:len(x)]
    fade = int(0.25 * FR)
    x[-fade:] *= np.linspace(1, 0, fade)[:, None]
    x *= 10 ** ((REF_RMS_DB[min(max(true, 43), 84)] - rms_db(x, 2, 6)) / 20)
    peak = np.abs(x).max()
    if peak > 10 ** (-1 / 20):
        x *= 10 ** (-1 / 20) / peak
    tmp = os.path.join(OUT, '_t.f32')
    x.astype(np.float32).tofile(tmp)
    out = os.path.join(OUT, fname(true) + '.mp3')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(FR), '-ac', '2', '-i', tmp,
                    '-codec:a', 'libmp3lame', '-b:a', '128k', '-joint_stereo', '0', out], check=True)
    os.remove(tmp)
    total += os.path.getsize(out)
    print(f'{f[:-4]:4} -> {fname(true):4} {os.path.getsize(out) // 1024} KB')
print(f'total {total / 1024 / 1024:.2f} MB')
