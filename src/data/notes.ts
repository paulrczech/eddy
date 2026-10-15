// Note names using sharps only (V1 convention)
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export type NoteName = typeof NOTE_NAMES[number]

// MIDI note constraints
export const MIDI_MIN = 40  // E2 — low boundary (lowest open string on standard-tuned guitar)
export const MIDI_MAX = 84  // C6 — high boundary
export const MIDI_SEED_MIN = 48        // C3 — random starts put the bass in octave 3 or above; a bass down in octave 2 (down to the global E2 floor) read as muddy and Paul was shifting every start up an octave by hand (2026-10-15)
export const MIDI_SEED_MAX = 59        // B3 — stays below middle C, so seeds land in octave 2-3

// Max semitone spread between lowest and highest voice in a cluster
export const MAX_CLUSTER_SPREAD = 40  // just over three octaves

export function midiToName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1
  const name = NOTE_NAMES[midi % 12]
  return `${name}${octave}`
}

export function midiToNoteName(midi: number): NoteName {
  return NOTE_NAMES[midi % 12]
}

export function midiToOctave(midi: number): number {
  return Math.floor(midi / 12) - 1
}

export function noteNameToMidi(name: NoteName, octave: number): number {
  return (octave + 1) * 12 + NOTE_NAMES.indexOf(name)
}

// Interval in semitones between two MIDI notes (always positive)
export function intervalSemitones(a: number, b: number): number {
  return Math.abs(a - b)
}

// Dissonance rank for an interval in semitones (mod 12, unordered)
// Lower = more consonant, higher = more dissonant
const DISSONANCE_RANK: Record<number, number> = {
  0: 0,   // unison
  7: 1,   // perfect fifth
  5: 2,   // perfect fourth
  9: 3,   // major sixth
  3: 4,   // minor third
  4: 5,   // major third
  8: 6,   // minor sixth
  10: 7,  // minor seventh
  2: 8,   // major second
  11: 9,  // major seventh
  1: 10,  // minor second
  6: 11,  // tritone
}

export function dissonanceRank(midiA: number, midiB: number): number {
  const interval = Math.abs(midiA - midiB) % 12
  return DISSONANCE_RANK[interval] ?? 5
}
