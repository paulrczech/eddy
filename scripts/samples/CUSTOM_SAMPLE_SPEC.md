# Custom sample spec — Eddy

What to record or render so a new instrument drops into the app without rework.

## The notes (same for every instrument)

16 roots, a minor third apart, E2 to C6 (MIDI 40-84):

E2 G2 A#2 C#3 E3 G3 A#3 C#4 E4 G4 A#4 C#5 E5 G5 A#5 C6

Eddy repitches the nearest root by at most 1.5 semitones, which sounds natural. (Guitar can use a
different but equally spaced set, e.g. E2 F#2 A2 C3 D#3 ... C6.) Name files by SOUNDING pitch, sharps
written "s": `E2.wav`, `As2.wav`, `Cs3.wav`.

## Per note

- One velocity layer, a natural mezzo-forte touch, the same touch on every note. No round robins.
  (Velocity in Eddy is only gain; it changes loudness, not timbre.)
- Bone dry: no reverb, delay, chorus, EQ, compression, amp ambience, or room. The app adds its own
  space later if wanted. A close-miked or DI sound is ideal.
- Start the note at the very beginning of the file (leading silence is trimmed, but do not clip the attack).
- Let it ring out naturally and stop the file, don't fade it: piano / felt piano 8 s; plucked guitar
  4-5 s; a swell or sustained sound 7-8 s. (Eddy holds a note a half-bar and then releases over 1.2-2 s.)
- No noise between or after notes: no pedal thumps, count-ins, string squeaks, fret buzz, breaths, or fans.
- Tuned to A = 440, within about 5 cents. Hit exactly the pitch in the name (one octave off is the
  commonest error in sample packs; I check every file by FFT, so tell me if you are unsure).
- 24-bit (16 is fine), 44.1 or 48 kHz WAV. Peaks below -3 dBFS, no clipping. Do NOT normalize each note;
  keep the natural loudness differences. I level the whole set by perceived loudness afterwards.
- Mono is fine for plucks and pianos; stereo only if the stereo image is the point (it doubles the size).

## Instrument notes

Felt piano
- Upright or grand with the felt (mute) strip engaged; soft, round, little hammer noise.
- Sustain pedal up. Each note's own natural decay.
- Low notes (E2-A#2) matter: Eddy sits low a lot, so record them cleanly and with enough body.

Electric guitar (decide the character first: "plucky" was rejected on the tonejs set)
- Swell / sustained (like Afterglow): volume-swell, EBow, or a bowed/long-sustain patch; 7-8 s; slow attack
  is fine. Or a soft, round fingerstyle clean tone with long sustain (neck pickup, tone rolled off, light
  compression only if baked into a DI you like).
- Standard tuning, lowest note E2 (open low E). C6 is fret 20 on the high E string, so the guitar needs 20+
  frets, or play those top notes on the neck's upper strings and keep the same tone.
- Same pickup, tone and strings throughout; no slides, bends, or hammer-ons.

## If rendering from someone else's sampler or library (Kontakt, Logic, Orange Tree...)

Recording your own removes the licence question entirely. If you render from a library, its EULA must allow
shipping the rendered notes inside a product (Orange Tree needed written permission). Logic's bundled
instruments, as I recall, allow use in your music but not distributing the isolated sounds on their own;
check Apple's Sound Library licence before relying on them.

## Handoff

A folder of the 16 WAVs, named as above. I verify pitch, level them with `scripts/samples/guitar-pluck.py`
(plucks and pianos) or `synth-pad.py` (sustained pads), encode MP3 (~0.5-1.5 MB per instrument), and wire it
in. Budget per instrument: 2 MB.
