// Scale definitions as semitone intervals from root (within one octave)
export interface ScaleDefinition {
  id: string
  name: string
  intervals: number[]  // semitones from root, 0–11
}

// Ordered as the Channel picker shows them (HomeView/SessionView): the familiar major/minor
// pair first, then the other diatonic modes, then the minor variants, then the colour scales.
// 'chromatic' is the "open" (no lock) state, not a real choice in the scale column.
export const SCALES: ScaleDefinition[] = [
  { id: 'chromatic',    name: 'Chromatic',    intervals: [0,1,2,3,4,5,6,7,8,9,10,11] },
  { id: 'major',        name: 'Major',        intervals: [0,2,4,5,7,9,11] },
  { id: 'minor',        name: 'Natural Minor', intervals: [0,2,3,5,7,8,10] },
  { id: 'dorian',       name: 'Dorian',       intervals: [0,2,3,5,7,9,10] },
  { id: 'phrygian',     name: 'Phrygian',     intervals: [0,1,3,5,7,8,10] },
  { id: 'lydian',       name: 'Lydian',       intervals: [0,2,4,6,7,9,11] },
  { id: 'mixolydian',   name: 'Mixolydian',   intervals: [0,2,4,5,7,9,10] },
  { id: 'locrian',      name: 'Locrian',      intervals: [0,1,3,5,6,8,10] },
  { id: 'harmonic_minor', name: 'Harmonic Minor', intervals: [0,2,3,5,7,8,11] },
  { id: 'melodic_minor', name: 'Melodic Minor', intervals: [0,2,3,5,7,9,11] },
  { id: 'lydian_dominant', name: 'Lydian Dominant', intervals: [0,2,4,6,7,9,10] },
  { id: 'lydian_augmented', name: 'Lydian Augmented', intervals: [0,2,4,6,8,9,11] },
  { id: 'altered',      name: 'Altered',      intervals: [0,1,3,4,6,8,10] },
  { id: 'whole_tone',   name: 'Whole Tone',   intervals: [0,2,4,6,8,10] },
  { id: 'diminished_hw', name: 'Diminished (Half-Whole)', intervals: [0,1,3,4,6,7,9,10] },
  { id: 'diminished_wh', name: 'Diminished (Whole-Half)', intervals: [0,2,3,5,6,8,9,11] },
  { id: 'pentatonic_major', name: 'Major Pentatonic', intervals: [0,2,4,7,9] },
  { id: 'pentatonic_minor', name: 'Minor Pentatonic', intervals: [0,3,5,7,10] },
]

export const SCALE_MAP = Object.fromEntries(SCALES.map(s => [s.id, s]))

// Given a root MIDI note and a scale, return all valid MIDI notes within range [min, max]
export function getScaleNotes(rootMidi: number, scaleId: string, min: number, max: number): number[] {
  const scale = SCALE_MAP[scaleId]
  if (!scale) return []
  const rootPc = rootMidi % 12  // pitch class of root
  const notes: number[] = []
  for (let midi = min; midi <= max; midi++) {
    const pc = midi % 12
    const interval = (pc - rootPc + 12) % 12
    if (scale.intervals.includes(interval)) {
      notes.push(midi)
    }
  }
  return notes
}
