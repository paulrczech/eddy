// Strategy rule vocabulary
// voicesAllowedToMove:
//   'all'          — every voice may move
//   'all-but-one'  — exactly one voice is held, others move
//   'one'          — exactly one voice moves
//   'two'          — exactly two voices move
//   'top'          — only the top voice moves
//   'bottom'       — only the bottom voice moves
//   'upper'        — all voices except the bottom
//   'lower'        — all voices except the top
//   'most-dissonant-held' — hold the voice in the most dissonant interval pair, others may move
//   'least-expected-held' — hold the statistically least common tone (random selection weighted toward middle voice), others may move
//   'third'        — only the voice a third above the bass moves (index 1 — the note
//                    that gives a triad its major/minor quality), regardless of voice count
//
// direction:
//   'any'          — up or down
//   'up'           — all moving voices go up
//   'down'         — all moving voices go down
//   'contrary'     — outer voices move in opposite directions
//
// movementType:
//   'step'         — half or whole step (1–2 semitones)
//   'half'         — half step only (1 semitone)
//   'whole'        — whole step only (2 semitones)
//   'third'        — up to a major third (1–4 semitones)
//   'free'         — any interval within range constraints
//   'chromatic-approach' — half step from above
//   'tritone'      — exactly 6 semitones
//   'same-root-new-quality' — root stays, other voices find new positions
//   'power'        — collapse to root + fifth only (special case)
//   'group-shift'  — all voices move by the same interval (half step to minor third), same
//                    direction — shape preserved, just transposed (voicesAllowedToMove: 'all' only)
//   'group-step'   — every voice moves independently by step, filtered to the current
//                    scale (voicesAllowedToMove: 'all' only)
//   'parallel-quality' — every voice moves independently by step, filtered to the
//                    parallel major/minor of the current key (voicesAllowedToMove: 'all' only)
//   'resolve-iv'   — every voice moves independently by step, filtered to the scale
//                    rooted a fourth above the current key (voicesAllowedToMove: 'all' only)

export interface Strategy {
  id: string
  text: string
  hint: string    // plain-language description of what the algorithm actually does
  voicesAllowedToMove: string
  movementType: string
  direction: string
  requiresKeyLock: boolean
  notes?: string  // optional clarification for implementation
}

export const STRATEGIES: Strategy[] = [
  {
    id: 'hold-one-move-others-step',
    text: 'Hold one, move all others by step',
    hint: 'One voice is anchored in place. Every other voice shifts by a half or whole step in either direction.',
    voicesAllowedToMove: 'all-but-one',
    movementType: 'step',
    direction: 'any',
    requiresKeyLock: false,
  },
  {
    id: 'keep-most-dissonant',
    text: 'Keep the note that hurts the most',
    hint: 'The voice forming the harshest interval (minor 2nd, tritone, or major 7th) is held fixed. The others move by step.',
    voicesAllowedToMove: 'most-dissonant-held',
    movementType: 'step',
    direction: 'any',
    requiresKeyLock: false,
    notes: 'Hold the voice participating in the highest-ranked dissonant interval pair. Others move by step.',
  },
  {
    id: 'top-stays',
    text: 'Let the top voice stay, everything beneath it shifts',
    hint: 'The highest voice is anchored. All voices below it move by a half or whole step.',
    voicesAllowedToMove: 'lower',
    movementType: 'step',
    direction: 'any',
    requiresKeyLock: false,
  },
  {
    id: 'one-voice-only',
    text: 'Move only one voice — make it count',
    hint: 'Exactly one voice moves. It can jump any interval within the movement size setting. All others stay.',
    voicesAllowedToMove: 'one',
    movementType: 'free',
    direction: 'any',
    requiresKeyLock: false,
  },
  {
    id: 'two-common-contrary',
    text: 'Keep two common tones, move the others in contrary motion',
    hint: 'All but one voice is held as a common tone. The single moving voice steps in any direction.',
    voicesAllowedToMove: 'one',
    movementType: 'step',
    direction: 'contrary',
    requiresKeyLock: false,
    notes: 'With N voices, hold N-1 and move 1. For 3 voices: hold 2, move 1 (contrary is moot with single voice — move freely). For 4+ voices: hold N-2, move 2 in contrary motion.',
  },
  {
    id: 'least-expected-survives',
    text: 'The note you least expect to survive — keep it',
    hint: 'A middle voice is held fixed (the one you might not think to keep). The outer voices and others move by step.',
    voicesAllowedToMove: 'least-expected-held',
    movementType: 'step',
    direction: 'any',
    requiresKeyLock: false,
    notes: 'Hold the middle voice (or random non-outer voice in 4+). Others move by step.',
  },
  {
    id: 'all-half-same-direction',
    text: 'Move every voice together, by the same small interval',
    hint: 'All voices slide together by the same amount — a half step, whole step, or minor third — either all up or all down. The cluster shape is preserved, just transposed.',
    voicesAllowedToMove: 'all',
    movementType: 'group-shift',
    direction: 'any',
    requiresKeyLock: false,
    notes: 'All voices move by the same interval (half step, whole step, or minor third), either all up or all down. Generate every step-size x direction combination.',
  },
  {
    id: 'hold-bass',
    text: 'Hold the bass, release everything above',
    hint: 'The bottom voice stays put. Every voice above it moves by a half or whole step.',
    voicesAllowedToMove: 'upper',
    movementType: 'step',
    direction: 'any',
    requiresKeyLock: false,
  },
  {
    id: 'parallel-mode',
    text: 'Borrow from the parallel',
    hint: 'Voices shift toward notes found in the parallel major or minor of your active key. Requires Key Lock to be on.',
    voicesAllowedToMove: 'all',
    movementType: 'parallel-quality',
    direction: 'any',
    requiresKeyLock: true,
    notes: 'Each voice independently steps toward the nearest note in the parallel major/minor (same root, opposite major/minor quality) of the current key. Requires Key Lock.',
  },
  {
    id: 'drop-the-third',
    text: 'Drop what defines you',
    hint: 'The middle voice — most often the 3rd that gives the cluster its major or minor quality — moves by step, changing the character.',
    voicesAllowedToMove: 'third',
    movementType: 'step',
    direction: 'any',
    requiresKeyLock: false,
    notes: 'Move the middle voice (most likely the 3rd) by step. Strips the defining quality of the cluster.',
  },
  {
    id: 'rise-by-half',
    text: 'Rise by half',
    hint: 'The bottom voice moves up exactly one semitone. All other voices stay.',
    voicesAllowedToMove: 'bottom',
    movementType: 'half',
    direction: 'up',
    requiresKeyLock: false,
  },
  {
    id: 'add-extension',
    text: "Add what you haven't earned yet",
    hint: 'The top voice reaches upward by a 3rd or more — pushing into extension territory (9th, 11th, 13th).',
    voicesAllowedToMove: 'top',
    movementType: 'third',
    direction: 'up',
    requiresKeyLock: false,
    notes: 'Top voice reaches up by a third or more (extension: 9th, 11th, 13th territory).',
  },
  {
    id: 'tritone-sub',
    text: "Go somewhere you can't come back from easily",
    hint: 'Voices shift by a tritone (exactly 6 semitones) — the most harmonically distant interval. Requires Key Lock.',
    voicesAllowedToMove: 'all',
    movementType: 'tritone',
    direction: 'any',
    requiresKeyLock: true,
    notes: 'All voices shift by the same tritone, either all up or all down (shape preserved). Requires Key Lock.',
  },
  {
    id: 'slash-chord',
    text: 'Let the bass contradict the top',
    hint: 'The bottom voice jumps to an unexpected note — a large interval away — while the upper voices stay or shift slightly.',
    voicesAllowedToMove: 'bottom',
    movementType: 'free',
    direction: 'any',
    requiresKeyLock: false,
    notes: 'Move the bottom voice by a large interval (3rd or more), creating a slash chord quality.',
  },
  {
    id: 'same-root-new-quality',
    text: 'Stay, but change everything',
    hint: 'The bottom voice is anchored. The upper voices shift by step, transforming the cluster quality around the same bass note.',
    voicesAllowedToMove: 'upper',
    movementType: 'step',
    direction: 'any',
    requiresKeyLock: false,
    notes: 'Bottom voice held. Upper voices shift to change the cluster quality.',
  },
  {
    id: 'resolve-wrong',
    text: 'Resolve somewhere wrong',
    hint: 'Voices move by step toward the IV chord instead of the expected I — a deceptive cadence. Requires Key Lock.',
    voicesAllowedToMove: 'all',
    movementType: 'resolve-iv',
    direction: 'any',
    requiresKeyLock: true,
    notes: 'Each voice independently steps toward the nearest note in the scale rooted a fourth above the current key (the IV/subdominant) instead of the tonic. Requires Key Lock.',
  },
  {
    id: 'relative-shift',
    text: 'What would the relative do?',
    hint: 'Voices step toward the relative major or minor — same key signature, different tonal center. Requires Key Lock.',
    voicesAllowedToMove: 'all',
    movementType: 'group-step',
    direction: 'any',
    requiresKeyLock: true,
    notes: 'Each voice independently steps within the current scale — the relative major/minor shares the exact same notes as the current key, just a different felt tonal center, so no separate scale lookup is needed. Requires Key Lock.',
  },
  {
    id: 'power-chord',
    text: 'Strip it to bones',
    hint: 'The cluster collapses toward just a root and fifth — all color removed, only the bare hollow interval remains.',
    voicesAllowedToMove: 'all',
    movementType: 'power',
    direction: 'any',
    requiresKeyLock: false,
    notes: 'Bass voice held as root; every voice above it independently steps to the nearest note whose pitch class is the root or the fifth above it. Special case — not a standard interval move.',
  },
  {
    id: 'chromatic-approach',
    text: 'Approach from a half step above',
    hint: 'One voice descends by a single semitone — landing on its target by stepping down from just above it.',
    voicesAllowedToMove: 'one',
    movementType: 'chromatic-approach',
    direction: 'down',
    requiresKeyLock: false,
    notes: 'One voice descends by a half step (approaching its current position from above).',
  },
  {
    id: 'modal-interchange',
    text: "Steal from a key you're not in",
    hint: 'One voice holds while the others shift using notes borrowed from a parallel mode. Requires Key Lock.',
    voicesAllowedToMove: 'all-but-one',
    movementType: 'step',
    direction: 'any',
    requiresKeyLock: true,
    notes: 'Modal interchange. Requires Key Lock.',
  },
]

export const STRATEGY_MAP = Object.fromEntries(STRATEGIES.map(s => [s.id, s]))
