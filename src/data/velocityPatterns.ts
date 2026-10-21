import type { InstrumentType } from '../stores/settingsStore'

// Arpeggio accent patterns — the shape a player gives a repeating arpeggio, as relative
// loud / medium / soft per note, instead of random jitter (which sounded sloppy; see
// DISABLE_HUMANIZATION in arpeggioEngine.ts). Source: Paul's own pattern list, 2026-10-21.
//
// Two kinds of pattern, which matter once voice count and grid vary:
//  - 'pass': about *which voice* gets the accent (thumb-on-bass, Alberti, p-i-m-a). Written
//    low to high, one letter per note of a single pass of the arpeggio — so it only applies
//    when the cell is exactly as long as the pass (3 voices up = 3 notes; 3 voices updown
//    = 4; 4 voices up = 4; 4 voices updown = 6). Reversed for 'down' so the loud note
//    stays on the bass.
//  - 'bar': a phrase shape over the grid (Lifeson's syncopation, the rolling wave). Tiles
//    across the bar's slots by position, whichever note lands there; applies when the cell
//    length divides the slots in a bar.
// The tags are a first guess — tune by ear.
export type VelocityLevel = 'L' | 'M' | 'S'
export type PatternFamily = 'guitar' | 'piano'

export interface VelocityPattern {
  id: string
  name: string
  family: PatternFamily
  meter: '4/4' | '3/4'
  anchor: 'pass' | 'bar'
  cell: string // one letter per slot/note: L, M or S
}

export const VELOCITY_PATTERNS: VelocityPattern[] = [
  // Guitar — 4/4
  { id: 'g-travis',     name: 'Travis / folk bass + fingers',     family: 'guitar', meter: '4/4', anchor: 'bar',  cell: 'LSMSLSMS' },
  { id: 'g-dotted',     name: 'Dotted 3+3+2 rock/delay arpeggio', family: 'guitar', meter: '4/4', anchor: 'bar',  cell: 'LSSMSSMS' },
  { id: 'g-pima',       name: 'Classical p-i-m-a',                family: 'guitar', meter: '4/4', anchor: 'pass', cell: 'LSMS' },
  { id: 'g-cascade',    name: 'Cascading pick arpeggio',          family: 'guitar', meter: '4/4', anchor: 'bar',  cell: 'LMSMLMSS' },
  { id: 'g-lifeson',    name: 'Lifeson-style',                    family: 'guitar', meter: '4/4', anchor: 'bar',  cell: 'LSMLSLSM' },
  // Guitar — 3/4
  { id: 'g-waltz',      name: 'Waltz bass-strum',                 family: 'guitar', meter: '3/4', anchor: 'pass', cell: 'LSM' },
  { id: 'g-fp8',        name: 'Fingerpicked eighths',             family: 'guitar', meter: '3/4', anchor: 'bar',  cell: 'LSMSSM' },
  { id: 'g-three',      name: 'Three notes per beat',             family: 'guitar', meter: '3/4', anchor: 'bar',  cell: 'LSMMSMMSM' },
  // Piano — 4/4
  { id: 'p-alberti',    name: 'Alberti bass',                     family: 'piano',  meter: '4/4', anchor: 'pass', cell: 'LSMS' },
  { id: 'p-wave',       name: 'Rolling wave, up and back',        family: 'piano',  meter: '4/4', anchor: 'bar',  cell: 'SMMLLMMS' },
  { id: 'p-ballad',     name: 'Ballad eighths',                   family: 'piano',  meter: '4/4', anchor: 'bar',  cell: 'LSMSMSMS' },
  { id: 'p-flow12',     name: '6/8 or 12/8 flowing arpeggio',     family: 'piano',  meter: '4/4', anchor: 'bar',  cell: 'LSMSMS' },
  // Piano — 3/4
  { id: 'p-oompah',     name: 'Oom-pah-pah waltz',                family: 'piano',  meter: '3/4', anchor: 'pass', cell: 'LSS' },
  { id: 'p-broken',     name: 'Broken-chord eighths',             family: 'piano',  meter: '3/4', anchor: 'bar',  cell: 'LSMSMS' },
  { id: 'p-triplets',   name: 'Rolling triplets, lean on top',    family: 'piano',  meter: '3/4', anchor: 'bar',  cell: 'LSMSSMSSM' },
]

// Letter -> velocity (0-1). Per family so the two can be tuned apart; same values for now.
// Velocity is only gain on our single-layer samples (no timbre change), so the steps are
// kept moderate: soft = about -5.5 dB under loud, never a hole in the line.
export const FAMILY_LEVELS: Record<PatternFamily, Record<VelocityLevel, number>> = {
  guitar: { L: 0.85, M: 0.65, S: 0.45 },
  piano:  { L: 0.85, M: 0.65, S: 0.45 },
}

// Per-instrument overrides of a family's levels, for an instrument that sits differently
// (merged over FAMILY_LEVELS). Acoustic guitar's loud notes stuck out a touch (Paul,
// 2026-10-21) — the pianos' sat well at 0.85.
export const INSTRUMENT_LEVELS: Partial<Record<InstrumentType, Partial<Record<VelocityLevel, number>>>> = {
  'guitar-acoustic': { L: 0.8 },
}

// Which instruments use which family's patterns. Anything not listed (synth, the sustained
// electric-guitar swell, pads) keeps today's flat velocity until it gets its own patterns.
export const VELOCITY_FAMILY: Partial<Record<InstrumentType, PatternFamily>> = {
  'guitar-acoustic': 'guitar',
  'electric-guitar': 'guitar', // the sustained "Afterglow" swell — same accent shapes (2026-10-21)
  piano: 'piano',
  'piano-salamander': 'piano',
}
