// "Spacing" (Home's "the current" sheet): how spread out a chord's voices are — close, normal
// or open. A chord's spread is top note minus bottom note, in semitones. Normal is the engine
// as it was before this setting existed (random starts cap at 14 semitones; no bias while
// flowing), so choosing it changes nothing. Measured over 400 simulated flows (2026-10-23):
// normal starts have median spread 9 (3 voices) / 12 (4 voices), p10 7 / 9, max 14 — so close
// only tightens a little (the dissonance gate already blocks true clusters), and open, which
// starts above normal's ceiling, is where the audible change is (guitar-style two-octave
// voicings). Measured also: under the default 1/2-1 step drift the spread holds near its
// start for 32 moves, but under 'free' drift it diffuses (4 voices: median 12 -> 22 by move 16),
// which is why the setting also leans candidate selection toward its band (useVoiceLeading).
export type Spacing = 'close' | 'normal' | 'open'

export interface SpreadBand {
  min: number // semitones, inclusive
  max: number
}

// Normal has no band: no constraint, no bias.
export const SPACING_BAND: Record<Exclude<Spacing, 'normal'>, Record<3 | 4, SpreadBand>> = {
  close: { 3: { min: 0, max: 9 }, 4: { min: 0, max: 11 } },
  open: { 3: { min: 15, max: 24 }, 4: { min: 17, max: 27 } },
}

export function spreadBand(spacing: Spacing | undefined, voices: number): SpreadBand | null {
  if (!spacing || spacing === 'normal') return null
  return SPACING_BAND[spacing][voices === 4 ? 4 : 3]
}

export function spreadOf(cluster: number[]): number {
  return cluster[cluster.length - 1] - cluster[0]
}
