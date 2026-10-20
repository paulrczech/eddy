import { SCALE_MAP } from './scales'

// The mood chooser: words that stand in for the channel's key/scale vocabulary. A mood is a
// scale; the root is rolled for you (see pickMoodRoot). Valence ladder borrowed from Drift
// (project-drift/src/engine/moods.ts): Lydian bright -> Phrygian dark, Locrian left out.
// Eddy has no arousal axis, so the tense/floating words use structurally unstable scales
// (whole tone, diminished) instead of a mode. Pentatonic is deliberately absent — with no
// half steps it leaves almost no moves under the ½-step drift cap (Paul, 2026-10-20).
export interface Mood {
  id: string
  label: string
  scaleId: string
}

export const MOODS: Mood[] = [
  { id: 'joyful',      label: 'joyful',      scaleId: 'lydian' },
  { id: 'happy',       label: 'happy',       scaleId: 'major' },
  { id: 'hopeful',     label: 'hopeful',     scaleId: 'mixolydian' },
  { id: 'dreamy',      label: 'dreamy',      scaleId: 'whole_tone' },
  { id: 'wistful',     label: 'wistful',     scaleId: 'dorian' },
  { id: 'bittersweet', label: 'bittersweet', scaleId: 'melodic_minor' },
  { id: 'melancholy',  label: 'melancholy',  scaleId: 'minor' },
  { id: 'longing',     label: 'longing',     scaleId: 'harmonic_minor' },
  { id: 'dark',        label: 'dark',        scaleId: 'phrygian' },
  { id: 'uneasy',      label: 'uneasy',      scaleId: 'diminished_hw' },
]

export const MOOD_MAP = Object.fromEntries(MOODS.map(m => [m.id, m]))

// A root (pitch class 0-11) for a mood's scale. With no notes to fit, any root. With notes
// (a hand-entered source, or the current cluster mid-flow), the root(s) that keep the most
// of them in the scale — ties broken at random — so the lock doesn't start by fighting the
// music already there.
export function pickMoodRoot(scaleId: string, fitNotes?: number[]): number {
  const intervals = SCALE_MAP[scaleId]?.intervals ?? []
  let best: number[] = []
  let bestScore = -1
  for (let root = 0; root < 12; root++) {
    const score = fitNotes
      ? fitNotes.filter(n => intervals.includes((((n - root) % 12) + 12) % 12)).length
      : 0
    if (score > bestScore) {
      bestScore = score
      best = [root]
    } else if (score === bestScore) {
      best.push(root)
    }
  }
  return best[Math.floor(Math.random() * best.length)]
}
